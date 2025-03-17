import { parentPort } from 'worker_threads';
// Use dynamic imports for OpenAI and Pinecone
let OpenAI;
let Pinecone;
import { createHash } from 'crypto';

// We'll initialize these in the setup function
let openai;
let pineconeClient;

// Simple in-memory cache for embeddings
const embeddingCache = new Map();

// Hash function for caching
function hashText(text) {
  return createHash('md5').update(text).digest('hex');
}

// Dynamically import dependencies to avoid Vercel bundling issues
async function setupDependencies() {
  try {
    // Import the packages dynamically
    const openaiModule = await import('openai');
    const pineconeModule = await import('@pinecone-database/pinecone');
    
    // Get the constructors
    OpenAI = openaiModule.OpenAI;
    Pinecone = pineconeModule.Pinecone;
    
    // Initialize the clients
    openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY || '',
    });
    
    pineconeClient = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY || '',
    });
    
    return true;
  } catch (error) {
    console.error('Error setting up dependencies:', error);
    return false;
  }
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
    // Make sure dependencies are set up
    const dependenciesReady = await setupDependencies();
    if (!dependenciesReady) {
      throw new Error('Failed to initialize dependencies');
    }
    
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
    console.error('Error processing chunks:', error);
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