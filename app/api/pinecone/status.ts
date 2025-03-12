import { NextResponse } from 'next/server';
import { Pinecone } from '@pinecone-database/pinecone';
import { PINECONE_INDEX_NAME } from '@/configuration/pinecone';

export async function GET() {
  try {
    // Initialize Pinecone
    const pineconeClient = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY || '',
    });
    
    const pineconeIndex = pineconeClient.Index(PINECONE_INDEX_NAME);
    
    // Get index stats
    const stats = await pineconeIndex.describeIndexStats();
    
    return NextResponse.json({ 
      success: true,
      namespace: PINECONE_INDEX_NAME,
      total_vector_count: stats.totalRecordCount,
      dimensions: stats.dimension,
    });
  } catch (error: unknown) {
    console.error('Error checking Pinecone status:', error);
    return NextResponse.json({ 
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    }, { status: 500 });
  }
}