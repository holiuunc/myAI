import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/middleware/auth';
import { supabaseAdmin } from '@/configuration/supabase';
import { getDocumentProcessingStatus } from '@/utilities/documents';

export async function GET(request: Request) {
  // Get query parameters
  const { searchParams } = new URL(request.url);
  const documentId = searchParams.get('id');
  
  if (!documentId) {
    return NextResponse.json(
      { error: 'Document ID is required' },
      { status: 400 }
    );
  }
  
  try {
    // Get authenticated user
    const user = await getAuthenticatedUser();
    
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }
    
    // Get document processing status using the new function
    const status = await getDocumentProcessingStatus(documentId, user.id);
    
    return NextResponse.json(status);
  } catch (error) {
    console.error('Error checking document status:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

// Add a POST endpoint to resume processing
export async function POST(request: Request) {
  try {
    // Parse request body
    const body = await request.json();
    const { documentId } = body;
    
    if (!documentId) {
      return NextResponse.json(
        { error: 'Document ID is required' },
        { status: 400 }
      );
    }
    
    // Get authenticated user
    const user = await getAuthenticatedUser();
    
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }
    
    // Import the resumeDocumentProcessing function
    const { resumeDocumentProcessing } = await import('@/utilities/documents');
    
    // Resume document processing
    await resumeDocumentProcessing(documentId, user.id);
    
    return NextResponse.json({ 
      success: true,
      message: 'Document processing resumed'
    });
  } catch (error) {
    console.error('Error resuming document processing:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
} 