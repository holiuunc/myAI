import { NextRequest, NextResponse } from 'next/server';
import { OpenAI } from 'openai';
import { Pinecone } from '@pinecone-database/pinecone';
import { createHash } from 'crypto';
import { getAuthenticatedUser } from '@/middleware/auth';

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || '',
});

// Initialize Pinecone
const pineconeClient = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY || '',
});

// Simple in-memory cache for embeddings (note: this will reset between function calls in serverless)
const embeddingCache = new Map();

// Hash function for caching
function hashText(text: string): string {
  return createHash('md5').update(text).digest('hex');
}

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

async function processChunks(chunks: any[], userId: string, indexName: string) {
  try {
    const pineconeIndex = pineconeClient.Index(indexName);
    const namespaceIndex = pineconeIndex.namespace(userId);
    
    // Process chunks in optimized batches
    const batchSize = 5; // Smaller batch size for API route to avoid timeouts
    const batches = [];
    
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      batches.push(batch);
    }
    
    // Process batches with embedding cache
    const processedBatches = await Promise.all(
      batches.map(async (batch) => {
        const batchEmbeddings = await Promise.all(
          batch.map(chunk => generateEmbeddingWithCache(chunk.text))
        );
        
        return batch.map((chunk, index) => ({
          ...chunk,
          embedding: batchEmbeddings[index],
        }));
      })
    );
    
    const embeddedChunks = processedBatches.flat();
    
    // Prepare vectors for Pinecone
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
    
    // Upload to Pinecone
    await namespaceIndex.upsert(vectors);
    
    return { success: true, chunksProcessed: chunks.length };
  } catch (error) {
    console.error('Error processing chunks:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

export async function POST(request: NextRequest) {
  try {
    // Verify authentication
    const user = await getAuthenticatedUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    // Get user ID from authenticated user
    const userId = user.id;
    
    // Parse request body
    const body = await request.json();
    const { chunks, indexName } = body;
    
    // Validate request data
    if (!chunks || !Array.isArray(chunks) || chunks.length === 0) {
      return NextResponse.json(
        { error: 'Invalid chunks data' },
        { status: 400 }
      );
    }
    
    if (!indexName) {
      return NextResponse.json(
        { error: 'Index name is required' },
        { status: 400 }
      );
    }
    
    // Process chunks
    const result = await processChunks(chunks, userId, indexName);
    
    if (result.success) {
      return NextResponse.json(result);
    } else {
      return NextResponse.json(
        { error: result.error },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('Error processing document:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error occurred' },
      { status: 500 }
    );
  }
} 