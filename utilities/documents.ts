import { v4 as uuidv4 } from 'uuid';
import { Pinecone } from '@pinecone-database/pinecone';
import { PINECONE_INDEX_NAME, QUESTION_RESPONSE_TOP_K } from '@/configuration/pinecone';
import { OpenAI } from 'openai';
import { chunkSchema, type Chunk, type UploadedDocument } from '@/types';
import { supabaseAdmin } from '@/configuration/supabase';

// Initialize Pinecone
const pineconeClient = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY || '',
});
const pineconeIndex = pineconeClient.Index(PINECONE_INDEX_NAME);

// Initialize OpenAI for embeddings
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || '',
});

// Update the getDocuments function to be user-specific
export async function getDocuments(userId?: string): Promise<UploadedDocument[]> {
  if (!userId) return [];
  
  const { data } = await supabaseAdmin
    .from('documents')
    .select('*')
    .eq('user_id', userId);
    
  return data || [];
}

// Update the processDocument function to store user ID
export async function processDocument(file: File, userId?: string): Promise<UploadedDocument> {
  if (!userId) {
    throw new Error("User must be logged in to upload documents");
  }
  
  console.log(`Processing document: ${file.name} for user: ${userId}`);
  
  // Extract content from the file (PDF, DOCX, or TXT)
  const content = await extractTextFromFile(file);
  console.log(`Extracted ${content.length} characters from file`);

  // Check for empty content
  if (!content || content.trim().length === 0) {
    throw new Error("The document appears to be empty or could not be processed");
  }
  
  // Create document metadata
  const document: UploadedDocument = {
    id: uuidv4(),
    title: file.name,
    created_at: new Date().toISOString(),
    content,
    user_id: userId,
  };
  
  // Store document in Supabase
  await supabaseAdmin
    .from('documents')
    .insert([{
      id: document.id,
      title: document.title,
      user_id: userId,
      created_at: document.created_at,
      file_type: file.type,
      status: 'complete',
      vector_count: 0 // Initial count, update after processing if needed
    }]);
  
  // Process document for RAG
  try {
    console.log('Starting RAG processing');
    await processDocumentForRAG(document);
    console.log('Completed RAG processing');
  } catch (error: unknown) {
    console.error('Error in processDocumentForRAG:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to process document for RAG: ${errorMessage}`);
  }
  
  return document;
}

// Update the deleteDocument function to check user ownership
export async function deleteDocument(id: string, userId: string, forceDelete = false): Promise<void> {
  console.log(`Server: deleteDocument called with ID ${id} for user ${userId} (forceDelete: ${forceDelete})`);
  
  try {
    // Check if document exists and belongs to user
    const { data: doc } = await supabaseAdmin
      .from('documents')
      .select('id')
      .eq('id', id)
      .eq('user_id', userId)
      .single();
    
    if (!doc) {
      console.log(`Document with ID ${id} not found or doesn't belong to user ${userId}`);
      throw new Error(`Document with ID ${id} not found or doesn't belong to you`);
    }
    
    // Delete from Supabase
    await supabaseAdmin
      .from('documents')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);
      
    console.log(`Removed document metadata for ID ${id}`);
    
    // Only attempt to remove from Pinecone if not force deleting
    if (!forceDelete) {
      try {
        // Pass the userId here!
        await deleteDocumentChunksFromPinecone(id, userId);
      } catch (pineconeError) {
        console.error(`Error deleting from Pinecone: ${pineconeError}`);
        // Only throw if not force deleting
        if (!forceDelete) throw pineconeError;
      }
    }
  } catch (error) {
    console.error(`Error in deleteDocument: ${error}`);
    // If force delete, don't throw the error
    if (!forceDelete) throw error;
  }
}

async function extractTextFromFile(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  
  if (file.type === 'application/pdf') {
    // For a proper implementation, you'd use pdf-parse library
    // Since you may not have it installed yet, let's handle text files first
    console.log('PDF detected - using plain text extraction for now');
    return new TextDecoder().decode(buffer);
  // biome-ignore lint/style/noUselessElse: <explanation>
  } else if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    // For a proper implementation, you'd use mammoth library
    console.log('DOCX detected - using plain text extraction for now');
    return new TextDecoder().decode(buffer);
  // biome-ignore lint/style/noUselessElse: <explanation>
  } else if (file.type === 'text/plain') {
    // Simple text file
    return new TextDecoder().decode(buffer);
  // biome-ignore lint/style/noUselessElse: <explanation>
  } else {
    console.warn(`Unsupported file type: ${file.type}, treating as plain text`);
    return new TextDecoder().decode(buffer);
  }
}

async function processDocumentForRAG(document: UploadedDocument): Promise<void> {
  // 1. Split document into chunks
  const chunks = splitIntoChunks(
    document.content, 
    document.id, 
    document.title,
    document.user_id // Pass user ID to chunks
  );
  
  // 2. Generate embeddings for each chunk
  const embeddedChunks = await generateEmbeddings(chunks);
  
  // 3. Store chunks in Pinecone
  await storeChunksInPinecone(embeddedChunks);
}

// biome-ignore lint/suspicious/noExplicitAny: <explanation>
export function splitIntoChunks(content: string, documentId: string, documentTitle: string, userId: string, chunkSize = 1000, overlap = 200): any[] {
  const chunks = [];
  let i = 0;
  
  while (i < content.length) {
    const chunkText = content.slice(i, i + chunkSize);
    const preContext = i > 0 ? content.slice(Math.max(0, i - overlap), i) : '';
    const postContext = content.slice(i + chunkSize, Math.min(content.length, i + chunkSize + overlap));
    
    chunks.push({
      text: chunkText,
      pre_context: preContext,
      post_context: postContext,
      source_url: documentId,
      source_description: documentTitle,
      order: Math.floor(i / chunkSize),
      user_id: userId, // Store userId with each chunk
    });
    
    i += chunkSize - overlap;
  }
  
  return chunks;
}

// biome-ignore lint/suspicious/noExplicitAny: <explanation>
async function generateEmbeddings(chunks: any[]): Promise<any[]> {
  const embeddedChunks = [];
  
  // Process chunks in batches to avoid rate limits
  for (const chunk of chunks) {
    const response = await openai.embeddings.create({
      model: 'text-embedding-ada-002',
      input: chunk.text,
    });
    
    embeddedChunks.push({
      ...chunk,
      embedding: response.data[0].embedding,
    });
  }
  
  return embeddedChunks;
}

// biome-ignore lint/suspicious/noExplicitAny: <explanation>
async function storeChunksInPinecone(embeddedChunks: any[]): Promise<void> {
  // Prepare vectors for upsert
  const vectors = embeddedChunks.map(chunk => ({
    id: `${chunk.source_url}-${chunk.order}`,
    values: chunk.embedding,
    metadata: {
      text: chunk.text,
      pre_context: chunk.pre_context,
      post_context: chunk.post_context,
      source_url: chunk.source_url,
      source_description: chunk.source_description,
      order: chunk.order,
      user_id: chunk.user_id, // Ensure user_id is in metadata for filtering
    },
  }));
  
  // Extract userId from the first chunk (they all have same user)
  const userId = embeddedChunks[0].user_id;
  
  // Get namespace-specific index (like in getRelatedDocuments function)
  const namespaceIndex = pineconeIndex.namespace(userId);
  
  // Upsert in batches of 100, using user's ID as namespace
  const batchSize = 100;
  for (let i = 0; i < vectors.length; i += batchSize) {
    const batch = vectors.slice(i, i + batchSize);
    console.log(`Upserting batch ${i/batchSize + 1} to Pinecone in namespace: ${userId}`);
    await namespaceIndex.upsert(batch);
  }
  
  console.log('Successfully stored chunks in Pinecone');
}

async function deleteDocumentChunksFromPinecone(documentId: string, userId: string): Promise<void> {
  console.log(`Deleting chunks for document ${documentId} from Pinecone namespace: ${userId}`);
  
  // Get namespace-specific index (consistent with other functions)
  const namespaceIndex = pineconeIndex.namespace(userId);
  
  // Delete by query, using the namespace-specific index
  await namespaceIndex.deleteMany({
    filter: { source_url: documentId }
    // No namespace parameter needed here
  });
}

// Add this function for single embeddings
async function generateEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: 'text-embedding-ada-002',
    input: text,
  });
  
  return response.data[0].embedding;
}

// Then update the getRelatedDocuments function
export async function getRelatedDocuments(question: string, userId: string) {
  const embedding = await generateEmbedding(question);
  
  // Use the namespace-specific index
  const namespaceIndex = pineconeIndex.namespace(userId);
  
  // Query using namespace-specific index (no need for namespace parameter)
  const results = await namespaceIndex.query({
    vector: embedding,
    topK: QUESTION_RESPONSE_TOP_K,
    includeMetadata: true
  });
  
  return results.matches;
}
