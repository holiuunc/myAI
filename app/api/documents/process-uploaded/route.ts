import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/configuration/supabase';
import { processUploadedDocument } from '@/utilities/documents';

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
    
    console.log(`Processing uploaded file from storage: ${filePath}`);
    
    // Download the file from Supabase storage
    const { data: fileData, error: downloadError } = await supabaseAdmin.storage
      .from('documents')
      .download(filePath);
      
    if (downloadError || !fileData) {
      console.error('Error downloading file from storage:', downloadError);
      return NextResponse.json(
        { error: `Failed to download file: ${downloadError?.message}` },
        { status: 500 }
      );
    }
    
    // Process the document
    const document = await processUploadedDocument(fileData, filePath, userId);
    
    // Return success response
    return NextResponse.json({
      success: true,
      document: {
        id: document.id,
        title: document.title,
        status: document.status,
        progress: document.progress,
        created_at: document.created_at
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