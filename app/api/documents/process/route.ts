import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/configuration/supabase';
import { processDocumentById } from '@/utilities/documents';

// This endpoint can be called by a cron job or webhook to process pending documents
export async function POST(request: Request) {
  // Simple API key validation for security
  // In production, use a more secure authentication method
  const headers = request.headers;
  const apiKey = headers.get('x-api-key');
  
  if (!apiKey || apiKey !== process.env.INTERNAL_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  try {
    // Get document ID from request body
    const body = await request.json();
    const { documentId } = body;
    
    if (!documentId) {
      // If no document ID is provided, find the oldest pending document
      const { data: pendingDocuments } = await supabaseAdmin
        .from('documents')
        .select('id')
        .eq('status', 'pending')
        .order('created_at')
        .limit(1);
      
      if (!pendingDocuments || pendingDocuments.length === 0) {
        return NextResponse.json({ message: 'No pending documents found' });
      }
      
      // Process the oldest pending document
      const result = await processDocumentById(pendingDocuments[0].id);
      return NextResponse.json(result);
    }
    
    // Process the specified document
    const result = await processDocumentById(documentId);
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error processing document:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Processing failed' },
      { status: 500 }
    );
  }
} 