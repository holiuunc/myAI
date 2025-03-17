import { parentPort } from 'worker_threads';
import { OpenAI } from 'openai';
import { Pinecone } from '@pinecone-database/pinecone';
import { createHash } from 'crypto';

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || '',
});

// Initialize Pinecone
const pineconeClient = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY || '',
});

// Simple in-memory cache for embeddings
const embeddingCache = new Map();

// Hash function for caching
function hashText(text) {
  return createHash('md5').update(text).digest('hex');
}

async function generateEmbeddingWithCache(text) {
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

async function processChunks(chunks, userId, indexName) {
  try {
    const pineconeIndex = pineconeClient.Index(indexName);
    const namespaceIndex = pineconeIndex.namespace(userId);
    
    // Process chunks in optimized batches
    const batchSize = 20;
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
    
    // Upload to Pinecone in optimized batches
    const pineconeChunks = [];
    for (let i = 0; i < vectors.length; i += 250) {
      pineconeChunks.push(vectors.slice(i, i + 250));
    }
    
    await Promise.all(
      pineconeChunks.map(async (batch, index) => {
        if (index > 0) await new Promise(resolve => setTimeout(resolve, 100));
        return namespaceIndex.upsert(batch);
      })
    );
    
    return { success: true };
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

// Handle worker messages
if (parentPort) {
  parentPort.on('message', async (data) => {
    const result = await processChunks(data.chunks, data.userId, data.indexName);
    parentPort.postMessage(result);
  });
} 