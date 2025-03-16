import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/middleware/auth';
import { supabaseAdmin } from '@/configuration/supabase';

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
    
    // Get document status
    const { data, error } = await supabaseAdmin
      .from('documents')
      .select('id, status, progress, error_message, created_at, updated_at')
      .eq('id', documentId)
      .eq('user_id', user.id)
      .single();
    
    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }
    
    if (!data) {
      return NextResponse.json(
        { error: 'Document not found' },
        { status: 404 }
      );
    }
    
    return NextResponse.json({ 
      documentId: data.id,
      status: data.status || 'unknown',
      progress: data.progress || 0,
      error: data.error_message,
      created_at: data.created_at,
      updated_at: data.updated_at
    });
  } catch (error) {
    console.error('Error checking document status:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
} 