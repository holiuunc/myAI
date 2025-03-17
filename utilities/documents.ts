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
  console.log(`Storing ${embeddedChunks.length} chunks in Pinecone using API route`);
  
  if (!embeddedChunks.length) {
    console.warn('No chunks to store in Pinecone');
    return;
  }
  
  // Get the user ID from the first chunk
  const userId = embeddedChunks[0].user_id;
  
  // Prepare chunks to send to the API
  const chunksToProcess = embeddedChunks.map((chunk: any) => ({
    text: chunk.text,
    pre_context: chunk.pre_context,
    post_context: chunk.post_context,
    source_url: chunk.source_url,
    source_description: chunk.source_description,
    order: chunk.order,
    user_id: chunk.user_id,
  }));
  
  // Set batch size to 200 as previously determined optimal value
  // This keeps within OpenAI's token limits while optimizing speed
  const batchSize = 200; // Based on previous optimization
  const batches = [];
  
  for (let i = 0; i < chunksToProcess.length; i += batchSize) {
    batches.push(chunksToProcess.slice(i, i + batchSize));
  }
  
  console.log(`Processing chunks in ${batches.length} batches of max ${batchSize} chunks each`);
  
  let totalChunksProcessed = 0;
  
  // Get the base URL for the API
  // In server-side code, we need to use the full URL, not a relative one
  // We'll use the NEXTAUTH_URL environment variable which should contain the site's base URL
  // This is typically something like https://your-app.vercel.app in production
  // or http://localhost:3000 in development
  const baseUrl = process.env.NEXTAUTH_URL || process.env.VERCEL_URL 
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000';
    
  const apiUrl = `${baseUrl}/api/documents/process`;
  
  // Calculate progress increments (from 25% to 95%)
  const progressStart = 25;
  const progressMax = 95;
  
  // Process batches serially to ensure progress updates are sequential and visible
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const batchNumber = i + 1;
    
    try {
      // Calculate a more dramatic progress increment for better visibility
      // Progress will jump by larger amounts for more visible UI feedback
      const currentProgress = Math.round(progressStart + ((progressMax - progressStart) * i / batches.length));
      
      // Update progress before processing batch
      if (documentId) {
        // Force immediate progress update with direct status update
        console.log(`Setting progress to ${currentProgress}% before processing batch ${batchNumber}/${batches.length}`);
        await supabaseAdmin
          .from('documents')
          .update({
            progress: currentProgress,
            status: 'processing',
            updated_at: new Date().toISOString()
          })
          .eq('id', documentId);
      }
      
      console.log(`Processing batch ${batchNumber}/${batches.length} with ${batch.length} chunks`);
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chunks: batch,
          indexName: PINECONE_INDEX_NAME, // Use the configured Pinecone index name
        }),
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to process chunks: ${errorText}`);
      }
      
      const result = await response.json();
      console.log(`Batch ${batchNumber} processed successfully: ${result.chunksProcessed} chunks`);
      
      totalChunksProcessed += (result.chunksProcessed || batch.length);
      
      // Update progress after processing batch with a higher value
      if (documentId && batchNumber < batches.length) {
        const nextProgress = Math.round(progressStart + ((progressMax - progressStart) * (i + 0.5) / batches.length));
        console.log(`Setting progress to ${nextProgress}% after processing batch ${batchNumber}/${batches.length}`);
        
        // Use direct update to ensure status and progress are updated
        await supabaseAdmin
          .from('documents')
          .update({
            progress: nextProgress,
            status: 'processing',
            updated_at: new Date().toISOString()
          })
          .eq('id', documentId);
      }
      
      // Small delay between batches to allow UI to update
      if (batchNumber < batches.length) {
        await new Promise(resolve => setTimeout(resolve, 750));
      }
    } catch (error) {
      console.error(`Error processing batch ${batchNumber}:`, error);
      throw error;
    }
  }
  
  console.log('Successfully stored all chunks in Pinecone via API route');
  
  // Final progress update before completion
  if (documentId) {
    console.log(`Setting progress to ${progressMax}% before finalizing`);
    await supabaseAdmin
      .from('documents')
      .update({
        progress: progressMax,
        status: 'processing',
        updated_at: new Date().toISOString()
      })
      .eq('id', documentId);
  }
}

async function deleteDocumentChunksFromPinecone(documentId: string, userId: string): Promise<void> {
  console.log(`Deleting chunks for document ${documentId} from Pinecone namespace: ${userId}`);
  
  try {
    // Get namespace-specific index
    const namespaceIndex = pineconeIndex.namespace(userId);
    
    // We need to handle potential pagination since a document might have more than 1000 vectors
    let totalDeleted = 0;
    let hasMoreVectors = true;
    
    while (hasMoreVectors) {
      // Query to get vector IDs for this document (up to 10000 at a time to handle large documents)
      console.log(`Querying for vectors of document ${documentId}, batch ${totalDeleted}`);
      const queryResponse = await namespaceIndex.query({
        vector: Array(1536).fill(0), // Dummy vector for query
        topK: 10000, // Get up to 10000 vectors at once
        filter: { source_url: documentId },
        includeMetadata: false
      });
      
      // Extract the vector IDs
      const vectorIds = queryResponse.matches.map(match => match.id);
      
      if (vectorIds.length === 0) {
        console.log(`No more vectors found for document ${documentId}`);
        hasMoreVectors = false;
        break;
      }
      
      console.log(`Found ${vectorIds.length} vectors to delete for document ${documentId}`);
      
      // Delete vectors in batches of 1000 to avoid timeouts
      const batchSize = 1000;
      for (let i = 0; i < vectorIds.length; i += batchSize) {
        const batch = vectorIds.slice(i, i + batchSize);
        await namespaceIndex.deleteMany(batch);
        console.log(`Deleted batch of ${batch.length} vectors (${i + batch.length}/${vectorIds.length})`);
      }
      
      totalDeleted += vectorIds.length;
      
      // If we got less than our query limit, we're done
      if (vectorIds.length < 10000) {
        hasMoreVectors = false;
      } else {
        // Add a small delay to prevent rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    // Perform a final verification query to make sure all vectors are deleted
    const verificationResponse = await namespaceIndex.query({
      vector: Array(1536).fill(0),
      topK: 100,
      filter: { source_url: documentId },
      includeMetadata: false
    });
    
    if (verificationResponse.matches.length > 0) {
      console.warn(`Found ${verificationResponse.matches.length} remaining vectors after deletion attempt. Trying one more time.`);
      
      // One more attempt with direct filter deletion
      const remainingIds = verificationResponse.matches.map(match => match.id);
      await namespaceIndex.deleteMany(remainingIds);
      
      console.log(`Completed second deletion attempt for remaining ${remainingIds.length} vectors`);
    }
    
    console.log(`Successfully deleted a total of ${totalDeleted} vectors for document ${documentId}`);
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
