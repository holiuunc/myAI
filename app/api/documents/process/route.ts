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
    // Additional logging to debug
    console.log(`Processing ${chunks.length} chunks for user ${userId} in index ${indexName}`);
    
    // Ensure we have an OpenAI API key
    if (!process.env.OPENAI_API_KEY) {
      console.error('Missing OpenAI API key in environment variables');
      throw new Error('OpenAI API key is required');
    }
    
    // Create index reference
    const pineconeIndex = pineconeClient.Index(indexName);
    const namespaceIndex = pineconeIndex.namespace(userId);
    
    // Process chunks in optimized batches
    const batchSize = 5; // Smaller batch size for API route to avoid timeouts
    const batches = [];
    
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      batches.push(batch);
    }
    
    console.log(`Split chunks into ${batches.length} batches for processing`);
    
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
    console.log(`Generated embeddings for ${embeddedChunks.length} chunks`);
    
    // Prepare vectors for Pinecone
    const vectors = embeddedChunks.map(chunk => ({
      id: `${chunk.source_url}-${chunk.order}`,
      values: chunk.embedding,
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
    
    // Upload to Pinecone
    console.log(`Upserting ${vectors.length} vectors to Pinecone`);
    await namespaceIndex.upsert(vectors);
    console.log('Upsert to Pinecone completed successfully');
    
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
    
    // Try to get user from authentication, but don't require it for server-to-server calls
    // For server-to-server calls, we'll use the user_id from the chunks
    let userId;
    try {
      const user = await getAuthenticatedUser();
      if (user) {
        userId = user.id;
      } else {
        // If no authenticated user, use the user_id from the first chunk
        // This allows server-to-server processing
        userId = chunks[0].user_id;
        
        if (!userId) {
          return NextResponse.json(
            { error: 'User ID is required but not found in chunks or authentication' },
            { status: 401 }
          );
        }
        console.log(`No authenticated user, using user_id from chunks: ${userId}`);
      }
    } catch (error) {
      // If authentication check fails, fall back to using the user_id from the chunks
      userId = chunks[0].user_id;
      
      if (!userId) {
        return NextResponse.json(
          { error: 'User ID is required but not found in chunks' },
          { status: 401 }
        );
      }
      console.log(`Authentication check failed, using user_id from chunks: ${userId}`);
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