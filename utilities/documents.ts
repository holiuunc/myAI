import { v4 as uuidv4 } from 'uuid';
import { Pinecone } from '@pinecone-database/pinecone';
import { PINECONE_INDEX_NAME, QUESTION_RESPONSE_TOP_K } from '@/configuration/pinecone';
import { OpenAI } from 'openai';
import { chunkSchema, type Chunk, type UploadedDocument } from '@/types';
import { supabaseAdmin } from '@/configuration/supabase';
import { MAX_FILE_SIZE_MB, ALLOWED_FILE_TYPES } from '@/configuration/documents';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';

// Initialize Pinecone
const pineconeClient = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY || '',
});
const pineconeIndex = pineconeClient.Index(PINECONE_INDEX_NAME);

// Initialize OpenAI for embeddings
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || '',
});

// Queue to track documents being processed
// In a production app, replace with a more robust solution like Redis or a database table
const processingQueue = new Map<string, boolean>();

// Update the getDocuments function to be user-specific
export async function getDocuments(userId?: string): Promise<UploadedDocument[]> {
  if (!userId) return [];
  
  const { data } = await supabaseAdmin
    .from('documents')
    .select('*')
    .eq('user_id', userId);
    
  return data || [];
}

// First phase: Quickly validate and store the document metadata
export async function uploadDocument(file: File, userId?: string): Promise<UploadedDocument> {
  if (!userId) {
    throw new Error("User must be logged in to upload documents");
  }
  
  console.log(`Uploading document: ${file.name} for user: ${userId}`);
  
  // Validate file size
  const maxFileSizeBytes = MAX_FILE_SIZE_MB * 1024 * 1024;
  if (file.size > maxFileSizeBytes) {
    throw new Error(`File exceeds maximum size of ${MAX_FILE_SIZE_MB}MB`);
  }
  
  // Validate file type
  if (!ALLOWED_FILE_TYPES.includes(file.type)) {
    throw new Error(`File type '${file.type}' not supported. Please upload PDF, DOCX, or text files.`);
  }
  
  // Extract content from the file (PDF, DOCX, or TXT)
  // Note: We still need to do this synchronously for now to validate the file content
  const content = await extractTextFromFile(file);
  console.log(`Extracted ${content.length} characters from file`);

  // Check for empty content
  if (!content || content.trim().length === 0) {
    throw new Error("The document appears to be empty or could not be processed");
  }
  
  // Create document metadata
  const documentId = uuidv4();
  const document: UploadedDocument = {
    id: documentId,
    title: file.name,
    created_at: new Date().toISOString(),
    content,
    user_id: userId,
    status: 'pending',
    progress: 0
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
      status: 'pending',
      progress: 0,
      vector_count: 0
    }]);
  
  // Trigger async processing of the document
  // Don't await this - we want to return quickly
  Promise.resolve().then(() => {
    processDocumentAsync(document)
      .catch((error: Error | unknown) => {
        console.error(`Async processing error for document ${documentId}:`, error);
        // Update document status to error
        void supabaseAdmin
          .from('documents')
          .update({
            status: 'error',
            error_message: error instanceof Error ? error.message : String(error)
          })
          .eq('id', documentId)
          .then(() => {
            console.log(`Updated document ${documentId} status to error`);
          });
      });
  });
  
  return document;
}

// Process a document asynchronously
async function processDocumentAsync(document: UploadedDocument): Promise<void> {
  const { id: documentId, user_id: userId } = document;
  
  // Skip if already being processed
  if (processingQueue.get(documentId)) {
    console.log(`Document ${documentId} is already being processed, skipping`);
    return;
  }
  
  // Mark as being processed
  processingQueue.set(documentId, true);
  
  try {
    // Update document status to processing
    await supabaseAdmin
      .from('documents')
      .update({
        status: 'processing',
        progress: 10,
        updated_at: new Date().toISOString()
      })
      .eq('id', documentId);
    
    console.log(`Processing document ${documentId} for RAG`);
    
    // 1. Split document into chunks with optimized size
    const chunks = splitIntoChunks(
      document.content, 
      document.id, 
      document.title,
      document.user_id,
      1500,  // Increased chunk size for fewer API calls
      150    // Reduced overlap while maintaining context
    );
    
    // Update progress after chunking
    await supabaseAdmin
      .from('documents')
      .update({
        progress: 30,
        updated_at: new Date().toISOString()
      })
      .eq('id', documentId);
    
    // 2. Process chunks in parallel with optimal batch sizes
    const totalChunks = chunks.length;
    const embeddedChunks = [];
    
    // Process in larger batches (20 chunks per batch)
    const batchSize = 20;
    const batches = [];
    
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      batches.push(batch);
    }
    
    // Process batches in parallel with rate limiting
    const processedBatches = await Promise.all(
      batches.map(async (batch, batchIndex) => {
        // Add a small delay between batches to prevent rate limiting
        if (batchIndex > 0) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
        
        const batchEmbeddings = await openai.embeddings.create({
          model: 'text-embedding-ada-002',
          input: batch.map(chunk => chunk.text),
        });
        
        return batch.map((chunk, index) => ({
          ...chunk,
          embedding: batchEmbeddings.data[index].embedding,
        }));
      })
    );
    
    // Flatten the results
    embeddedChunks.push(...processedBatches.flat());
    
    // Update progress to 70%
    await supabaseAdmin
      .from('documents')
      .update({
        progress: 70,
        updated_at: new Date().toISOString()
      })
      .eq('id', documentId);
    
    // 3. Store chunks in Pinecone with optimized batching
    await storeChunksInPinecone(embeddedChunks);
    
    // Update document status to complete
    await supabaseAdmin
      .from('documents')
      .update({
        status: 'complete',
        progress: 100,
        vector_count: chunks.length,
        updated_at: new Date().toISOString()
      })
      .eq('id', documentId);
    
    console.log(`Completed processing for document ${documentId}`);
  } catch (error) {
    console.error(`Error processing document ${documentId}:`, error);
    
    // Update document status to error
    await supabaseAdmin
      .from('documents')
      .update({
        status: 'error',
        error_message: error instanceof Error ? error.message : String(error),
        updated_at: new Date().toISOString()
      })
      .eq('id', documentId);
    
    throw error;
  } finally {
    // Always remove from processing queue
    processingQueue.delete(documentId);
  }
}

// Helper to update document progress
async function updateDocumentProgress(documentId: string, progress: number): Promise<void> {
  await supabaseAdmin
    .from('documents')
    .update({ progress })
    .eq('id', documentId);
}

// Legacy function name for backward compatibility
export const processDocument = uploadDocument;

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

function sanitizeText(text: string): string {
  return text
    // Replace invalid UTF-16 surrogate pairs
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/g, '')
    // Replace other problematic characters
    .replace(/[\u0000-\u0008\u000B-\u000C\u000E-\u001F\uFFFD\uFFFE\uFFFF]/g, '')
    // Normalize Unicode characters
    .normalize('NFKC');
}

async function extractTextFromFile(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  
  let text: string;
  
  try {
    if (file.type === 'application/pdf') {
      const pdfData = await pdfParse(buffer);
      text = pdfData.text;
    } else if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const result = await mammoth.extractRawText({ arrayBuffer: arrayBuffer });
      text = result.value;
    } else if (file.type === 'text/plain') {
      text = new TextDecoder().decode(buffer);
    } else {
      console.warn(`Unsupported file type: ${file.type}, treating as plain text`);
      text = new TextDecoder().decode(buffer);
    }
    
    // Clean up common issues in extracted text
    text = text
      // Remove excessive whitespace
      .replace(/\s+/g, ' ')
      // Remove excessive newlines
      .replace(/\n\s*\n/g, '\n')
      // Trim whitespace
      .trim();
    
    // Sanitize the extracted text
    return sanitizeText(text);
  } catch (error) {
    console.error(`Error extracting text from ${file.type} file:`, error);
    throw new Error(`Failed to extract text from ${file.type} file: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export function splitIntoChunks(content: string, documentId: string, documentTitle: string, userId: string, chunkSize = 1000, overlap = 200): any[] {
  const chunks = [];
  let i = 0;
  
  while (i < content.length) {
    const chunkText = sanitizeText(content.slice(i, i + chunkSize));
    const preContext = i > 0 ? sanitizeText(content.slice(Math.max(0, i - overlap), i)) : '';
    const postContext = sanitizeText(content.slice(i + chunkSize, Math.min(content.length, i + chunkSize + overlap)));
    
    chunks.push({
      text: chunkText,
      pre_context: preContext,
      post_context: postContext,
      source_url: documentId,
      source_description: documentTitle,
      order: Math.floor(i / chunkSize),
      user_id: userId,
    });
    
    i += chunkSize - overlap;
  }
  
  return chunks;
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
      user_id: chunk.user_id,
    },
  }));
  
  const userId = embeddedChunks[0].user_id;
  const namespaceIndex = pineconeIndex.namespace(userId);
  
  // Optimize batch size for Pinecone (increased to 250)
  const batchSize = 250;
  const batches = [];
  
  for (let i = 0; i < vectors.length; i += batchSize) {
    batches.push(vectors.slice(i, i + batchSize));
  }
  
  // Process Pinecone batches in parallel with rate limiting
  await Promise.all(
    batches.map(async (batch, index) => {
      // Add a small delay between batches
      if (index > 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      console.log(`Upserting batch ${index + 1}/${batches.length} to Pinecone`);
      return namespaceIndex.upsert(batch);
    })
  );
  
  console.log('Successfully stored all chunks in Pinecone');
}

async function deleteDocumentChunksFromPinecone(documentId: string, userId: string): Promise<void> {
  console.log(`Deleting chunks for document ${documentId} from Pinecone namespace: ${userId}`);
  
  try {
    // Get namespace-specific index
    const namespaceIndex = pineconeIndex.namespace(userId);
    
    // First, query to get all vector IDs for this document
    const queryResponse = await namespaceIndex.query({
      vector: Array(1536).fill(0), // Dummy vector for query
      topK: 1000, // Get up to 1000 vectors
      filter: { source_url: documentId },
      includeMetadata: false
    });
    
    // Extract the vector IDs
    const vectorIds = queryResponse.matches.map(match => match.id);
    
    if (vectorIds.length === 0) {
      console.log(`No vectors found for document ${documentId}`);
      return;
    }
    
    console.log(`Found ${vectorIds.length} vectors to delete for document ${documentId}`);
    
    // Delete by IDs (supported in all plans)
    await namespaceIndex.deleteMany(vectorIds);
    
    console.log(`Successfully deleted ${vectorIds.length} vectors for document ${documentId}`);
  } catch (error) {
    console.error(`Error deleting vectors for document ${documentId}:`, error);
    throw error;
  }
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

// Process a document by ID
export async function processDocumentById(documentId: string): Promise<{success: boolean; message: string}> {
  console.log(`Processing document by ID: ${documentId}`);
  
  try {
    // Get document from database
    const { data: document, error } = await supabaseAdmin
      .from('documents')
      .select('*')
      .eq('id', documentId)
      .single();
    
    if (error) {
      console.error(`Error fetching document ${documentId}:`, error);
      return { success: false, message: `Document not found: ${error.message}` };
    }
    
    if (!document) {
      return { success: false, message: 'Document not found' };
    }
    
    // Skip if not in pending status
    if (document.status !== 'pending') {
      return { 
        success: false, 
        message: `Document is not pending (current status: ${document.status})` 
      };
    }
    
    // Process the document asynchronously
    // Use void to indicate we're not waiting for the result
    void processDocumentAsync(document);
    
    return { 
      success: true, 
      message: `Started processing document ${documentId}` 
    };
  } catch (error) {
    console.error(`Error in processDocumentById for ${documentId}:`, error);
    return { 
      success: false, 
      message: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}
