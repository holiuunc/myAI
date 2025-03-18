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
    
    // Check if there's already a similar document
    // This check helps avoid duplicates with the same name
    const { data: existingDocs } = await supabaseAdmin
      .from('documents')
      .select('id, title, status')
      .eq('user_id', userId)
      .eq('title', fileName)
      .order('created_at', { ascending: false })
      .limit(5);

    // If there's an existing document with the same name being processed, 
    // we'll mark this as a replacement document
    const isReplacement = existingDocs && existingDocs.length > 0 && 
      ['processing', 'processing_paused', 'pending'].includes(existingDocs[0].status);
    
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
        processing_stage: 'queued',
        file_path: filePath,
        is_replacement: isReplacement, // Track if this is replacing another document
        replace_doc_id: isReplacement ? existingDocs[0].id : null
      }]);
      
    if (insertError) {
      console.error('Error creating document record:', insertError);
      return NextResponse.json(
        { error: `Failed to create document record: ${insertError.message}` },
        { status: 500 }
      );
    }
    
    // For Vercel's environment, we need to handle timing differently
    // Instead of starting immediately, use a setTimeout to give this function time to return
    const isVercel = !!process.env.VERCEL;
    
    if (isVercel) {
      // In Vercel, trigger the background process using a fetch to ensure this function returns quickly
      console.log('Vercel environment detected, using fetch for background processing');
      
      // Get base URL for internal API calls
      const baseUrl = process.env.VERCEL_URL 
        ? `https://${process.env.VERCEL_URL}` 
        : (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000');
      
      // Fire the background processing request without waiting
      fetch(`${baseUrl}/api/documents/background-process`, {
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
      });
    } else {
      // For local dev, use the normal approach
      // Trigger background processing without awaiting
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
      });
    }
    
    return NextResponse.json({
      success: true,
      document: {
        id: documentId,
        title: fileName,
        status: 'pending'
      },
      message: 'Document processing initiated successfully'
    });
  } catch (error) {
    console.error('Error handling document upload:', error);
    return NextResponse.json(
      { error: `Processing error: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 }
    );
  }
}