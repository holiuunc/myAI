import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/configuration/supabase';
import { v4 as uuidv4 } from 'uuid';

export async function POST(request: Request) {
  try {
    const { filePath, userId } = await request.json();
    
    if (!filePath) {
      return NextResponse.json(
        { error: 'File path is required' },
        { status: 400 }
      );
    }
    
    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 }
      );
    }
    
    console.log(`Initiating background processing for file: ${filePath}`);
    
    // Extract filename from the path
    const pathParts = filePath.split('/');
    const fileName = pathParts[pathParts.length-1];
    
    // Create document record immediately with pending status
    const documentId = uuidv4();
    const { error: insertError } = await supabaseAdmin
      .from('documents')
      .insert([{
        id: documentId,
        title: fileName,
        user_id: userId,
        created_at: new Date().toISOString(),
        status: 'pending',
        progress: 0,
        vector_count: 0,
        processing_stage: 'queued'
      }]);
      
    if (insertError) {
      console.error('Error creating document record:', insertError);
      return NextResponse.json(
        { error: `Failed to create document record: ${insertError.message}` },
        { status: 500 }
      );
    }
    
    // Trigger background processing using Edge Runtime
    // We don't await this - it will run in the background
    fetch(new URL('/api/documents/background-process', request.url).toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        documentId,
        filePath,
        userId
      }),
    }).catch(error => {
      console.error('Error triggering background processing:', error);
      // Non-critical error - the document is already created
    });
    
    // Return success response immediately
    return NextResponse.json({
      success: true,
      document: {
        id: documentId,
        title: fileName,
        status: 'pending',
        progress: 0,
        created_at: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Error processing uploaded document:', error);
    return NextResponse.json(
      { error: `Failed to process document: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 }
    );
  }
}