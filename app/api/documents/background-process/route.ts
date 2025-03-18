import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/configuration/supabase';
import { processUploadedDocument } from '@/utilities/documents';

// Set to Node.js runtime to support file system operations
export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const { documentId, filePath, userId, resuming } = await request.json();
    
    if (!documentId || !userId) {
      return NextResponse.json(
        { error: 'Document ID and user ID are required' },
        { status: 400 }
      );
    }
    
    // If resuming, we don't need filePath
    if (!resuming && !filePath) {
      return NextResponse.json(
        { error: 'File path is required for new document processing' },
        { status: 400 }
      );
    }
    
    // If resuming a paused document, we handle it differently
    if (resuming) {
      console.log(`Resuming processing for document ${documentId}`);
      
      // Get document details from database
      const { data: document, error: dbError } = await supabaseAdmin
        .from('documents')
        .select('*')
        .eq('id', documentId)
        .eq('user_id', userId)
        .single();
        
      if (dbError || !document) {
        console.error('Error retrieving document details:', dbError);
        return NextResponse.json(
          { error: 'Failed to retrieve document details' },
          { status: 500 }
        );
      }
      
      // Check if we've already completed chunking - we can proceed without the file
      if (document.processing_stage === 'embedding' || 
          document.processing_stage === 'embedding_prep') {
        
        console.log(`Document ${documentId} already chunked, resuming from batch ${document.current_batch || 0}/${document.batch_count || 0}`);
        
        // For documents that have been chunked but need to continue embedding
        // we'll import and use the resumeBatchProcessing function from documents.ts
        try {
          const { resumeBatchProcessing } = await import('@/utilities/documents');
          
          // Resume processing from the current batch
          await resumeBatchProcessing(documentId, userId);
          
          return NextResponse.json({
            success: true,
            message: 'Document processing resumed successfully'
          });
        } catch (error) {
          console.error(`Error resuming batch processing: ${error}`);
          
          // Update document status to error
          await supabaseAdmin
            .from('documents')
            .update({
              status: 'error',
              error_message: `Failed to resume batch processing: ${error instanceof Error ? error.message : 'Unknown error'}`,
              updated_at: new Date().toISOString()
            })
            .eq('id', documentId);
            
          return NextResponse.json(
            { error: `Failed to resume batch processing: ${error instanceof Error ? error.message : 'Unknown error'}` },
            { status: 500 }
          );
        }
      }
      
      // For documents not yet chunked, we need the original file
      if (!document.file_path) {
        throw new Error('File path not found in document record');
      }
      
      console.log(`Re-downloading file ${document.file_path} for resuming processing`);
      
      const { data: fileData, error: downloadError } = await supabaseAdmin.storage
        .from('documents')
        .download(document.file_path);
        
      if (downloadError || !fileData) {
        console.error('Error re-downloading file from storage:', downloadError);
        throw new Error(`Failed to re-download file: ${downloadError?.message}`);
      }
      
      // Update status to processing
      await supabaseAdmin
        .from('documents')
        .update({
          status: 'processing',
          processing_stage: 'resuming',
          updated_at: new Date().toISOString()
        })
        .eq('id', documentId);
        
      console.log(`Resuming processing for document ${documentId} using re-downloaded file`);
      
      // Process the document again with the re-downloaded file
      await processUploadedDocument(fileData, document.file_path, userId);
      
      return NextResponse.json({
        success: true,
        message: 'Document processing resumed successfully'
      });
    }
    
    console.log(`Background processing started for document ${documentId}, file: ${filePath}`);
    
    // Update document status to processing
    await supabaseAdmin
      .from('documents')
      .update({
        status: 'processing',
        progress: 5,
        processing_stage: 'downloading',
        updated_at: new Date().toISOString()
      })
      .eq('id', documentId);
    
    // Download the file from Supabase storage
    const { data: fileData, error: downloadError } = await supabaseAdmin.storage
      .from('documents')
      .download(filePath);
      
    if (downloadError || !fileData) {
      console.error('Error downloading file from storage:', downloadError);
      
      // Update document status to error
      await supabaseAdmin
        .from('documents')
        .update({
          status: 'error',
          error_message: `Failed to download file: ${downloadError?.message}`,
          updated_at: new Date().toISOString()
        })
        .eq('id', documentId);
        
      return NextResponse.json(
        { error: `Failed to download file: ${downloadError?.message}` },
        { status: 500 }
      );
    }
    
    // Update progress
    await supabaseAdmin
      .from('documents')
      .update({
        progress: 10,
        processing_stage: 'text_extraction',
        updated_at: new Date().toISOString()
      })
      .eq('id', documentId);
    
    // Process document - this will handle staged processing internally
    try {
      await processUploadedDocument(fileData, filePath, userId);
      
      // Note: We don't need to update status here as processUploadedDocument handles status updates
      console.log(`Background processing completed successfully for document ${documentId}`);
      
      return NextResponse.json({
        success: true,
        message: 'Document processing initiated successfully'
      });
    } catch (processingError) {
      console.error(`Error in document processing for ${documentId}:`, processingError);
      
      // Update document status to error - though processUploadedDocument might have already done this
      try {
        await supabaseAdmin
          .from('documents')
          .update({
            status: 'error',
            error_message: `Processing error: ${processingError instanceof Error ? processingError.message : 'Unknown error'}`,
            updated_at: new Date().toISOString()
          })
          .eq('id', documentId);
          
        console.log(`Updated document ${documentId} status to error`);
      } catch (updateError) {
        console.error(`Failed to update error status for document ${documentId}:`, updateError);
      }
      
      return NextResponse.json(
        { error: `Processing error: ${processingError instanceof Error ? processingError.message : 'Unknown error'}` },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('Error in background processing:', error);
    return NextResponse.json(
      { error: `Background processing error: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 }
    );
  }
} 