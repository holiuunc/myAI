import { v4 as uuidv4 } from 'uuid';
import { Pinecone } from '@pinecone-database/pinecone';
import { PINECONE_INDEX_NAME } from '@/configuration/pinecone';
import { OpenAI } from 'openai';
import type { UploadedDocument } from '@/types';

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
  // Extract content from the file (PDF, DOCX, or TXT)
  const content = await extractTextFromFile(file);
  
  // Create document metadata
  const document: UploadedDocument = {
    id: uuidv4(),
    title: file.name,
    created_at: new Date().toISOString(),
    content,
  };
  
  // Store document metadata
  documents.push(document);
  
  // Process document for RAG
  await processDocumentForRAG(document);
  
  return document;
}

export async function deleteDocument(id: string): Promise<void> {
  // Remove document metadata
  documents = documents.filter(doc => doc.id !== id);
  
  // Remove document chunks from Pinecone
  await deleteDocumentChunksFromPinecone(id);
}

async function extractTextFromFile(file: File): Promise<string> {
  // Extract text based on file type
  const buffer = Buffer.from(await file.arrayBuffer());
  
  if (file.type === 'application/pdf') {
    // Use a PDF parsing library (you'll need to install one)
    // Example: return extractTextFromPDF(buffer);
    return "PDF extraction - implement with pdf-parse or similar library";
  }
  if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    // Use a DOCX parsing library (you'll need to install one)
    // Example: return extractTextFromDOCX(buffer);
    return "DOCX extraction - implement with mammoth or similar library";
  }
  if (file.type === 'text/plain') {
    // Simple text file
    return buffer.toString('utf-8');
  }
  
  throw new Error('Unsupported file type');
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
function splitIntoChunks(content: string, documentId: string, documentTitle: string, chunkSize = 1000, overlap = 200): any[] {
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
    await pineconeIndex.upsert(batch);
  }
}

async function deleteDocumentChunksFromPinecone(documentId: string): Promise<void> {
  // Delete all vectors with matching document ID
  await pineconeIndex.deleteMany({
    filter: {
      source_url: { $eq: documentId },
    },
  });
}