import { v4 as uuidv4 } from 'uuid';
import { Pinecone } from '@pinecone-database/pinecone';
import { PINECONE_INDEX_NAME, QUESTION_RESPONSE_TOP_K } from '@/configuration/pinecone';
import { OpenAI } from 'openai';
import { chunkSchema, type Chunk, type UploadedDocument } from '@/types';

// Initialize Pinecone
const pineconeClient = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY || '',
});
const pineconeIndex = pineconeClient.Index(PINECONE_INDEX_NAME);

// Initialize OpenAI for embeddings
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || '',
});

// In-memory storage for document metadata (replace with a database in production)
let documents: UploadedDocument[] = [];

export async function getDocuments(): Promise<UploadedDocument[]> {
  return documents;
}

export async function processDocument(file: File): Promise<UploadedDocument> {
  console.log(`Processing document: ${file.name}`);
  
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
  };
  
  console.log(`Created document metadata with ID: ${document.id}`);
  
  // Store document metadata
  documents.push(document);
  
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

export async function deleteDocument(id: string, forceDelete = false): Promise<void> {
  console.log(`Server: deleteDocument called with ID ${id} (forceDelete: ${forceDelete})`);
  
  try {
    // First check if the document exists
    const docIndex = documents.findIndex(doc => doc.id === id);
    
    if (docIndex === -1) {
      console.log(`Document with ID ${id} not found`);
      throw new Error(`Document with ID ${id} not found`);
    }
    
    // Always remove document metadata
    documents = documents.filter(doc => doc.id !== id);
    console.log(`Removed document metadata for ID ${id}`);
    
    // Only attempt to remove from Pinecone if not force deleting
    if (!forceDelete) {
      try {
        // Remove document chunks from Pinecone
        await deleteDocumentChunksFromPinecone(id);
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
  const chunks = splitIntoChunks(document.content, document.id, document.title);
  
  // 2. Generate embeddings for each chunk
  const embeddedChunks = await generateEmbeddings(chunks);
  
  // 3. Store chunks in Pinecone
  await storeChunksInPinecone(embeddedChunks);
}

// biome-ignore lint/suspicious/noExplicitAny: <explanation>
export function splitIntoChunks(content: string, documentId: string, documentTitle: string, chunkSize = 1000, overlap = 200): any[] {
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
    },
  }));
  
  // Upsert in batches of 100
  const batchSize = 100;
  for (let i = 0; i < vectors.length; i += batchSize) {
    const batch = vectors.slice(i, i + batchSize);
    console.log(`Upserting batch ${i/batchSize + 1} to Pinecone`);
    await pineconeIndex.upsert(batch);
  }
  
  console.log('Successfully stored chunks in Pinecone');
}

async function deleteDocumentChunksFromPinecone(documentId: string): Promise<void> {
  console.log(`Deleting chunks for document ${documentId} from Pinecone`);
  
  try {
    // Validate Pinecone index
    if (!pineconeIndex) {
      console.error('Pinecone index is not initialized');
      return;
    }
    
    // Delete all vectors with matching document ID
    const deleteResponse = await pineconeIndex.deleteMany({
      filter: {
        source_url: { $eq: documentId },
      },
    });
    
    console.log(`Pinecone deletion response: ${JSON.stringify(deleteResponse)}`);
  } catch (error) {
    console.error(`Error deleting chunks from Pinecone: ${error}`);
    // Log but don't throw - continue with document deletion even if Pinecone fails
  }
}