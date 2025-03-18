import { v4 as uuidv4 } from 'uuid';
import { Pinecone } from '@pinecone-database/pinecone';
import { PINECONE_INDEX_NAME, QUESTION_RESPONSE_TOP_K } from '@/configuration/pinecone';
import { OpenAI } from 'openai';
import { chunkSchema, type Chunk, type UploadedDocument } from '@/types';
import { supabaseAdmin } from '@/configuration/supabase';
import { MAX_FILE_SIZE_MB, ALLOWED_FILE_TYPES } from '@/configuration/documents';
import PDFParser from 'pdf2json';
import { resolvePDFJS } from 'pdfjs-serverless';
import { createHash } from 'crypto';

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

// Simple in-memory cache for embeddings
const embeddingCache = new Map();

// Hash function for caching
function hashText(text: string): string {
  return createHash('md5').update(text).digest('hex');
}

// OpenAI embedding generation with caching
async function generateEmbeddingWithCache(text: string) {
  const hash = hashText(text);
  
  if (embeddingCache.has(hash)) {
    return embeddingCache.get(hash);
  }
  
  const response = await openai.embeddings.create({
    model: 'text-embedding-ada-002',
    input: text,
  });
  
  const embedding = response.data[0].embedding;
  embeddingCache.set(hash, embedding);
  
  return embedding;
}

// Update the getDocuments function to be user-specific
export async function getDocuments(userId?: string): Promise<UploadedDocument[]> {
  if (!userId) return [];
  
  const { data } = await supabaseAdmin
    .from('documents')
    .select('*')
    .eq('user_id', userId);
    
  // Clean up document titles by removing UUID prefixes
  if (data && data.length > 0) {
    data.forEach(doc => {
      if (doc.title && doc.title.includes('-')) {
        // Check for UUID pattern (same logic as in processUploadedDocument)
        const uuidPattern = /^[a-f0-9]{8}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{12}-/i;
        const match = doc.title.match(uuidPattern);
        
        if (match && match[0]) {
          // Remove the UUID prefix including the trailing hyphen
          doc.title = doc.title.substring(match[0].length);
        } else {
          // Fallback: try to match a simpler pattern (like 'abc123-filename.txt')
          const parts = doc.title.split('-');
          // Check if first part might be an ID (alphanumeric, typically 8-12 chars)
          if (parts.length > 1 && /^[a-f0-9]{7,32}$/i.test(parts[0])) {
            doc.title = parts.slice(1).join('-');
          }
        }
      }
    });
  }
    
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
  
  // Ensure we're using the actual file name, not a path or ID
  const fileName = file.name.includes('/') ? file.name.split('/').pop() || file.name : file.name;
  
  // Create document metadata
  const documentId = uuidv4();
  const document: UploadedDocument = {
    id: documentId,
    title: fileName,
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
    console.log(`Setting initial status for document ${documentId}`);
    await supabaseAdmin
      .from('documents')
      .update({
        status: 'processing',
        progress: 5,
        updated_at: new Date().toISOString()
      })
      .eq('id', documentId);
    
    console.log(`Processing document ${documentId} for RAG`);
    
    // 1. Split document into chunks with optimized size - update to 15%
    console.log(`Updating progress to 15% - chunking stage`);
    await supabaseAdmin
      .from('documents')
      .update({
        status: 'processing',
        progress: 15,
        updated_at: new Date().toISOString()
      })
      .eq('id', documentId);
    
    const result = splitIntoChunks(
      document.content, 
      document.id, 
      document.title,
      document.user_id,
      2000,  // Increased chunk size for fewer API calls
      200    // Reduced overlap while maintaining context
    );
    
    const { chunks, metrics } = result;
    
    // Store metrics in Supabase for user visibility - update to 25%
    console.log(`Updating progress to 25% - embedding preparation stage`);
    await supabaseAdmin
      .from('documents')
      .update({
        status: 'processing',
        progress: 25,
        updated_at: new Date().toISOString()
      })
      .eq('id', documentId);
    
    // 2. Process chunks using the storeChunksInPinecone function instead of worker threads
    try {
      // Create a proper structure for chunks before embedding
      const preparedChunks = chunks.map(chunk => ({
        text: chunk.text,
        pre_context: chunk.pre_context,
        post_context: chunk.post_context,
        source_url: chunk.source_url,
        source_description: chunk.source_description,
        order: chunk.order,
        user_id: chunk.user_id,
      }));
      
      // Process more chunks in parallel by using a higher batch size for better performance
      await storeChunksInPinecone(preparedChunks, documentId);
      
      // Update document status to complete - 100%
      console.log(`Setting final status for document ${documentId} to complete (100%)`);
      await supabaseAdmin
        .from('documents')
        .update({
          status: 'complete',
          progress: 100,
          vector_count: chunks.length,
          updated_at: new Date().toISOString()
        })
        .eq('id', documentId);
      
      // Verify the update was successful by explicitly checking
      const { data: verifyDoc, error: verifyError } = await supabaseAdmin
        .from('documents')
        .select('progress, status')
        .eq('id', documentId)
        .single();
        
      if (verifyError) {
        console.error(`Failed to verify final update: ${verifyError.message}`);
      } else {
        console.log(`Verified final document state: Progress=${verifyDoc.progress}%, Status=${verifyDoc.status}`);
      }
      
      console.log(`Completed processing for document ${documentId}`);
    } catch (error) {
      console.error(`Error processing document ${documentId}:`, error);
      
      // Update document status to error
      console.log(`Setting error status for document ${documentId}`);
      await supabaseAdmin
        .from('documents')
        .update({
          status: 'error',
          progress: 0,
          error_message: error instanceof Error ? error.message : String(error),
          updated_at: new Date().toISOString()
        })
        .eq('id', documentId);
      
      throw error;
    }
  } catch (error) {
    console.error(`Error processing document ${documentId}:`, error);
    
    // Update document status to error
    console.log(`Setting error status for document ${documentId} (outer catch)`);
    await supabaseAdmin
      .from('documents')
      .update({
        status: 'error',
        progress: 0,
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

// Helper to update document progress with additional metadata for UI
async function updateDocumentProgress(documentId: string, progress: number, status?: string, additionalData?: any): Promise<void> {
  // Create the base update data with the required progress field
  const updateData: any = { 
    progress,
    updated_at: new Date().toISOString()
  };
  
  // Always include status when provided
  if (status) {
    updateData.status = status;
  }
  
  // Log clear information about what's being updated
  console.log(`Updating document ${documentId}: Progress=${progress}%, Status=${status || 'unchanged'}`);
  
  try {
    // Execute the base update first to ensure progress and status are updated
    const { error } = await supabaseAdmin
      .from('documents')
      .update(updateData)
      .eq('id', documentId);
      
    if (error) {
      throw error;
    }
    
    // Verify the update was successful
    const { data: updatedDoc, error: verifyError } = await supabaseAdmin
      .from('documents')
      .select('id, progress, status')
      .eq('id', documentId)
      .single();
      
    if (verifyError) {
      console.error(`Failed to verify document update: ${verifyError.message}`);
    } else {
      console.log(`Document updated successfully: Progress=${updatedDoc.progress}%, Status=${updatedDoc.status}`);
    }
  } catch (error) {
    console.error(`Failed to update progress for document ${documentId}:`, error);
    
    // Attempt a fallback update with only the essential fields
    try {
      console.log(`Attempting fallback update for document ${documentId} with minimal fields`);
      await supabaseAdmin
        .from('documents')
        .update({ 
          progress, 
          status: status || 'processing',
          updated_at: new Date().toISOString()
        })
        .eq('id', documentId);
    } catch (fallbackError) {
      console.error(`Even fallback update failed: ${fallbackError}`);
    }
  }
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
      .select('id, title')
      .eq('id', id)
      .eq('user_id', userId)
      .single();
    
    if (!doc) {
      console.log(`Document with ID ${id} not found or doesn't belong to user ${userId}`);
      throw new Error(`Document with ID ${id} not found or doesn't belong to you`);
    }
    
    // 1. Delete the file from storage first
    try {
      const { error: storageError } = await supabaseAdmin.storage
        .from('documents')
        .remove([`${userId}/${doc.title}`]);
        
      if (storageError) {
        console.warn(`Failed to delete storage file for document ${id}: ${storageError.message}`);
        // Continue with deletion even if storage file deletion fails
      } else {
        console.log(`Deleted storage file for document ${id}`);
      }
    } catch (storageError) {
      console.warn(`Error deleting storage file: ${storageError}`);
      // Continue with deletion even if storage file deletion fails
    }
    
    // 2. Delete from Supabase database
    await supabaseAdmin
      .from('documents')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);
      
    console.log(`Removed document metadata for ID ${id}`);
    
    // 3. Only attempt to remove from Pinecone if not force deleting
    if (!forceDelete) {
      try {
        await deleteDocumentChunksFromPinecone(id, userId);
      } catch (pineconeError) {
        console.error(`Error deleting from Pinecone: ${pineconeError}`);
        if (!forceDelete) throw pineconeError;
      }
    }
  } catch (error) {
    console.error(`Error in deleteDocument: ${error}`);
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
      // First try pdfjs-serverless as it's more reliable in serverless environments
      try {
        // Capture console warnings temporarily
        const originalWarn = console.warn;
        console.warn = (message: string, ...args: any[]) => {
          // Filter out known noise warnings
          if (message && typeof message === 'string' &&
              !(message.includes('Unsupported color mode') || 
                message.includes('field.type of Link') || 
                message.includes('NOT valid form element'))) {
            originalWarn.apply(console, [message, ...args]);
          }
        };
        
        try {
          const { getDocument } = await resolvePDFJS();
          // Convert Buffer to Uint8Array
          const uint8Array = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
          const pdf = await getDocument({ data: uint8Array, useSystemFonts: true }).promise;
          
          let fullText = '';
          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items
              .filter((item: any) => 'str' in item) // Filter for text items that have 'str' property
              .map((item: any) => item.str)
              .join(' ');
            fullText += `${pageText} `;
          }
          text = fullText;
        } finally {
          // Restore original console.warn regardless of success/failure
          console.warn = originalWarn;
        }
      } catch (pdfJsError) {
        console.warn('pdfjs-serverless failed, falling back to pdf2json:', pdfJsError);
        // Fall back to pdf2json if pdfjs-serverless fails
        
        // Capture console warnings temporarily
        const originalWarn = console.warn;
        console.warn = (message: string, ...args: any[]) => {
          // Filter out known noise warnings
          if (message && typeof message === 'string' &&
              !(message.includes('Unsupported color mode') || 
                message.includes('field.type of Link') || 
                message.includes('NOT valid form element'))) {
            originalWarn.apply(console, [message, ...args]);
          }
        };
        
        try {
          const pdfParser = new PDFParser(null);
          
          // Convert the promise-based API to use async/await
          text = await new Promise<string>((resolve, reject) => {
            pdfParser.on('pdfParser_dataError', (errData: any) => reject(errData.parserError));
            pdfParser.on('pdfParser_dataReady', () => {
              resolve(pdfParser.getRawTextContent());
            });
            
            pdfParser.parseBuffer(buffer);
          });
        } finally {
          // Restore original console.warn regardless of success/failure
          console.warn = originalWarn;
        }
      }
    } else if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      // For DOCX, we can use a simple text extraction approach
      // Note: Full DOCX parsing is not available in serverless environments
      // You may need to use a cloud function or API for comprehensive DOCX support
      try {
        // Simplified DOCX extraction - just extract readable text content
        // This won't preserve formatting but will get the text content
        text = new TextDecoder().decode(buffer)
          .replace(/\uFFFD/g, ' ') // Replace replacement character with space
          .replace(/[^\x20-\x7E\n\r\t]/g, ' '); // Keep only ASCII printable chars
      } catch (docxError) {
        console.error('DOCX extraction failed:', docxError);
        throw new Error(`DOCX extraction failed: ${docxError instanceof Error ? docxError.message : 'Unknown error'}`);
      }
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

// Add this function to your documents.ts file
export async function processUploadedDocument(
  fileData: Blob, 
  filePath: string,
  userId: string
): Promise<UploadedDocument> {
  console.log(`Processing uploaded file from storage: ${filePath}`);
  
  if (!userId) {
    throw new Error("User must be logged in to process documents");
  }
  
  // Extract filename from the path
  const pathParts = filePath.split('/');
  const fileName = pathParts[pathParts.length-1];
  
  // UUID format is typically xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx (36 chars with hyphens)
  // The format is usually uuid-filename, so we need to remove the prefix
  let originalFileName = fileName;
  
  // Check if there's a UUID prefix (look for a pattern like: 8-4-4-4-12 hex chars followed by a hyphen)
  const uuidPattern = /^[a-f0-9]{8}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{12}-/i;
  const match = fileName.match(uuidPattern);
  if (match && match[0]) {
    // Remove the UUID prefix including the trailing hyphen
    originalFileName = fileName.substring(match[0].length);
  } else if (fileName.includes('-')) {
    // Fallback: try to match a simpler pattern (like 'abc123-filename.txt')
    const parts = fileName.split('-');
    // Check if first part might be an ID (alphanumeric, typically 8-12 chars)
    if (parts.length > 1 && /^[a-f0-9]{7,32}$/i.test(parts[0])) {
      originalFileName = parts.slice(1).join('-');
    }
  }
  
  console.log(`Extracted original filename: "${originalFileName}" from path: "${filePath}"`);
  
  // Determine file type based on name or blob type
  const fileType = fileData.type || 
    (originalFileName.endsWith('.pdf') ? 'application/pdf' : 
     originalFileName.endsWith('.docx') ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' :
     'text/plain');
  
  // Validate file type
  if (!ALLOWED_FILE_TYPES.includes(fileType)) {
    throw new Error(`File type '${fileType}' not supported. Please upload PDF, DOCX, or text files.`);
  }
  
  // Extract content from the blob
  const text = await extractTextFromBlob(fileData);
  console.log(`Extracted ${text.length} characters from file`);

  // Check for empty content
  if (!text || text.trim().length === 0) {
    throw new Error("The document appears to be empty or could not be processed");
  }
  
  // Create document metadata
  const documentId = uuidv4();
  const document: UploadedDocument = {
    id: documentId,
    title: originalFileName,
    created_at: new Date().toISOString(),
    content: text,
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
      file_type: fileType,
      status: 'pending',
      progress: 0,
      vector_count: 0
    }]);
  
  // Start async processing of the document
  Promise.resolve().then(() => {
    processDocumentAsync(document)
      .catch((error: Error | unknown) => {
        console.error(`Async processing error for document ${documentId}:`, error);
        void supabaseAdmin
          .from('documents')
          .update({
            status: 'error',
            error_message: error instanceof Error ? error.message : String(error)
          })
          .eq('id', documentId);
      });
  });

  // After successful processing, delete the original file
  try {
    const { error: storageError } = await supabaseAdmin.storage
      .from('documents')
      .remove([filePath]);
      
    if (storageError) {
      console.warn(`Failed to delete processed file ${filePath}: ${storageError.message}`);
    } else {
      console.log(`Deleted processed file ${filePath} to save storage space`);
    }
  } catch (storageError) {
    console.warn(`Error during cleanup of processed file: ${storageError}`);
    // Non-critical error, don't throw
  }
  
  return document;
}

// Helper function to extract text from a Blob
async function extractTextFromBlob(blob: Blob): Promise<string> {
  // Convert Blob to ArrayBuffer
  const arrayBuffer = await blob.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  
  let text: string;
  
  try {
    // Use existing logic but with buffer instead of file
    if (blob.type === 'application/pdf') {
      // First try pdfjs-serverless as it's more reliable
      try {
        const { getDocument } = await resolvePDFJS();
        const uint8Array = new Uint8Array(buffer);
        const pdf = await getDocument({ data: uint8Array, useSystemFonts: true }).promise;
        
        let fullText = '';
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          const pageText = textContent.items
            .filter((item: any) => 'str' in item)
            .map((item: any) => item.str)
            .join(' ');
          fullText += `${pageText} `;
        }
        text = fullText;
      } catch (pdfJsError) {
        console.warn('pdfjs-serverless failed, falling back to pdf2json:', pdfJsError);
        
        const pdfParser = new PDFParser(null);
        text = await new Promise<string>((resolve, reject) => {
          pdfParser.on('pdfParser_dataError', (errData: any) => reject(errData.parserError));
          pdfParser.on('pdfParser_dataReady', () => {
            resolve(pdfParser.getRawTextContent());
          });
          
          pdfParser.parseBuffer(buffer);
        });
      }
    } else if (blob.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      // Simplified DOCX extraction using same approach as in extractTextFromFile
      text = new TextDecoder().decode(buffer)
        .replace(/\uFFFD/g, ' ')
        .replace(/[^\x20-\x7E\n\r\t]/g, ' ');
    } else {
      // Plain text
      text = new TextDecoder().decode(buffer);
    }
    
    // Clean up as in extractTextFromFile
    text = text
      .replace(/\s+/g, ' ')
      .replace(/\n\s*\n/g, '\n')
      .trim();
    
    return sanitizeText(text);
  } catch (error) {
    console.error(`Error extracting text:`, error);
    throw new Error(`Text extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// Helper function to find the best split point in a text
function findSplitPoint(text: string, targetLength: number): number {
  // If text is shorter than target, return full length
  if (text.length <= targetLength) return text.length;
  
  // Look for sentence end within reasonable bounds
  const searchEnd = Math.min(targetLength + 100, text.length);
  const searchText = text.slice(0, searchEnd);
  
  // Try to find sentence boundary
  const sentences = searchText.match(/[.!?]\s+/g);
  if (sentences) {
    let lastIndex = 0;
    for (const match of sentences) {
      const nextIndex = searchText.indexOf(match, lastIndex) + match.length;
      if (nextIndex > targetLength) {
        return lastIndex || targetLength;
      }
      lastIndex = nextIndex;
    }
    return lastIndex || targetLength;
  }
  
  // Fall back to word boundary if no sentence boundary found
  const words = searchText.slice(0, targetLength + 20).split(/\s+/);
  let length = 0;
  for (let i = 0; i < words.length; i++) {
    const nextLength = length + words[i].length + (i > 0 ? 1 : 0); // +1 for space
    if (nextLength > targetLength) {
      return length || targetLength;
    }
    length = nextLength;
  }
  
  // If no good boundary found, use targetLength
  return targetLength;
}

export function splitIntoChunks(content: string, documentId: string, documentTitle: string, userId: string, chunkSize = 2000, overlap = 200): { chunks: any[]; metrics: any } {
  if (!content || typeof content !== 'string') {
    console.warn('Invalid content provided to splitIntoChunks');
    return { chunks: [], metrics: {} };
  }

  // Clean the content - normalize whitespace but preserve paragraph breaks
  const cleanContent = content
    .replace(/\r\n/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .trim();

  if (cleanContent.length === 0) {
    console.warn('Content is empty after cleaning');
    return { chunks: [], metrics: {} };
  }

  // Constants and validation
  const MIN_CHUNK_SIZE = 100;
  const MAX_CHUNK_SIZE = 8000; // Conservative limit well below OpenAI's token limit
  const effectiveChunkSize = Math.min(Math.max(chunkSize, MIN_CHUNK_SIZE), MAX_CHUNK_SIZE);
  const effectiveOverlap = Math.min(overlap, Math.floor(effectiveChunkSize / 4));

  const chunks: Array<{
    text: string;
    pre_context: string;
    post_context: string;
    source_url: string;
    source_description: string;
    order: number;
    user_id: string;
  }> = [];

  // Split into initial paragraphs
  const paragraphs = cleanContent.split(/\n\s*\n/).filter(p => p.trim());
  let currentChunk = '';
  let processedChars = 0;

  function createChunk(text: string, isLastChunk: boolean = false) {
    if (!text.trim()) return;
    
    chunks.push({
      text: text.trim(),
      pre_context: chunks.length > 0 ? chunks[chunks.length - 1].text.slice(-effectiveOverlap) : '',
      post_context: '', // Will be updated later
      source_url: documentId,
      source_description: documentTitle,
      order: chunks.length,
      user_id: userId
    });
    processedChars += text.length;
  }

  // Process each paragraph
  for (let i = 0; i < paragraphs.length; i++) {
    const paragraph = paragraphs[i].trim();
    if (!paragraph) continue;

    // If adding this paragraph would exceed chunk size, process current chunk
    if (currentChunk && (currentChunk.length + paragraph.length + 1 > effectiveChunkSize)) {
      createChunk(currentChunk);
      currentChunk = '';
    }

    // If paragraph itself exceeds chunk size, split it
    if (paragraph.length > effectiveChunkSize) {
      // First, flush current chunk if any
      if (currentChunk) {
        createChunk(currentChunk);
        currentChunk = '';
      }

      // Split large paragraph
      let remainingText = paragraph;
      while (remainingText) {
        const splitPoint = findSplitPoint(remainingText, effectiveChunkSize);
        const chunk = remainingText.slice(0, splitPoint).trim();
        if (chunk) {
          createChunk(chunk);
        }
        remainingText = remainingText.slice(splitPoint).trim();
        
        // Safety check
        if (splitPoint === 0) {
          console.error('Split point calculation failed, forcing split to prevent infinite loop');
          remainingText = '';
        }
      }
    } else {
      // Normal case: add to current chunk or start new one
      if (currentChunk) {
        currentChunk = `${currentChunk} ${paragraph}`;
      } else {
        currentChunk = paragraph;
      }
    }
  }

  // Process final chunk if any
  if (currentChunk) {
    createChunk(currentChunk, true);
  }

  // Update post_context for all chunks
  for (let i = 0; i < chunks.length - 1; i++) {
    chunks[i].post_context = chunks[i + 1].text.slice(0, effectiveOverlap);
  }

  // Validation and logging
  const totalInputChars = cleanContent.length;
  const totalOutputChars = chunks.reduce((sum, chunk) => sum + chunk.text.length, 0);
  const coverage = (totalOutputChars / totalInputChars) * 100;

  console.log(`Document processing statistics:
  - Original content length: ${totalInputChars} characters
  - Processed content length: ${totalOutputChars} characters
  - Coverage: ${coverage.toFixed(2)}%
  - Number of chunks: ${chunks.length}
  - Average chunk size: ${Math.round(totalOutputChars / chunks.length)} characters
  - Largest chunk: ${Math.max(...chunks.map(c => c.text.length))} characters
  - Smallest chunk: ${Math.min(...chunks.map(c => c.text.length))} characters`);

  if (coverage < 95) {
    console.warn(`Warning: Content coverage is below 95% (${coverage.toFixed(2)}%). This might indicate content loss.`);
  }

  if (chunks.some(chunk => chunk.text.length > MAX_CHUNK_SIZE)) {
    console.warn('Warning: Some chunks exceed maximum size limit');
  }

  // Return chunks and processing metrics
  return {
    chunks,
    metrics: {
      totalInputChars,
      totalOutputChars,
      coverage: coverage.toFixed(2),
      chunkCount: chunks.length,
      avgChunkSize: Math.round(totalOutputChars / chunks.length),
      largestChunk: Math.max(...chunks.map(c => c.text.length)),
      smallestChunk: Math.min(...chunks.map(c => c.text.length)),
    }
  };
}

// biome-ignore lint/suspicious/noExplicitAny: <explanation>
async function storeChunksInPinecone(embeddedChunks: any[], documentId?: string): Promise<void> {
  console.log(`Storing ${embeddedChunks.length} chunks in Pinecone directly`);
  
  if (!embeddedChunks.length) {
    console.warn('No chunks to store in Pinecone');
    return;
  }
  
  // Get the user ID from the first chunk
  const userId = embeddedChunks[0].user_id;
  
  try {
    // Get namespace-specific index
    const namespaceIndex = pineconeIndex.namespace(userId);
    
    // Process chunks in batches with reasonable size
    const batchSize = 100;
    const batches = [];
    
    for (let i = 0; i < embeddedChunks.length; i += batchSize) {
      batches.push(embeddedChunks.slice(i, i + batchSize));
    }
    
    // Generate embeddings and process batches
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      console.log(`Processing batch ${i+1}/${batches.length} with ${batch.length} chunks`);
      
      // Generate embeddings
      const batchEmbeddings = await Promise.all(
        batch.map(chunk => generateEmbeddingWithCache(chunk.text))
      );
      
      // Prepare vectors for Pinecone
      const vectors = batch.map((chunk, index) => ({
        id: `${chunk.source_url}-${chunk.order}`,
        values: batchEmbeddings[index],
        metadata: {
          text: chunk.text,
          pre_context: chunk.pre_context || '',
          post_context: chunk.post_context || '',
          source_url: chunk.source_url,
          source_description: chunk.source_description || '',
          order: chunk.order || 0,
          user_id: chunk.user_id,
        },
      }));
      
      // Upload to Pinecone directly
      await namespaceIndex.upsert(vectors);
      
      // Update document progress if we have a document ID
      if (documentId) {
        const progress = Math.round(25 + ((95 - 25) * (i + 1) / batches.length));
        await updateDocumentProgress(documentId, progress);
      }
    }
    
    console.log('Successfully stored all chunks in Pinecone');
  } catch (error) {
    console.error('Error storing chunks in Pinecone:', error);
    throw error;
  }
}

async function deleteDocumentChunksFromPinecone(documentId: string, userId: string): Promise<void> {
  console.log(`Deleting chunks for document ${documentId} from Pinecone for user ${userId}`);
  
  try {
    // Get namespace-specific index
    const namespaceIndex = pineconeIndex.namespace(userId);
    
    // Create a dummy vector for querying (using OpenAI's embedding dimension)
    const dummyVector = Array(1536).fill(0);
    
    // Search for chunks with the document ID in metadata
    console.log(`Searching for vectors with document ID: ${documentId}`);
    const queryResponse = await namespaceIndex.query({
      vector: dummyVector,
      topK: 10000,
      filter: { 
        source_url: { $eq: documentId } 
      },
      includeMetadata: true
    });
    
    // Extract IDs to delete
    const vectorIds = queryResponse.matches.map(match => match.id);
    
    if (vectorIds.length > 0) {
      console.log(`Found ${vectorIds.length} vectors to delete`);
      
      // Delete in batches of 1000 or fewer (Pinecone's limit)
      const batchSize = 1000;
      const batches = [];
      
      for (let i = 0; i < vectorIds.length; i += batchSize) {
        batches.push(vectorIds.slice(i, i + batchSize));
      }
      
      console.log(`Deleting vectors in ${batches.length} batches`);
      
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        console.log(`Deleting batch ${i + 1}/${batches.length} with ${batch.length} vectors`);
        await namespaceIndex.deleteMany(batch);
      }
      
      console.log(`Successfully deleted ${vectorIds.length} chunks for document ${documentId}`);
    } else {
      console.log(`No vectors found for document ${documentId}`);
    }

  } catch (error) {
    console.error(`Error deleting chunks from Pinecone:`, error);
    throw error;
  }
}