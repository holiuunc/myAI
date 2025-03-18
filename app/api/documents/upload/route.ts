import { NextRequest, NextResponse } from 'next/server';
import { processDocument } from '@/utilities/documents';
import { MAX_FILE_SIZE_MB } from '@/configuration/documents';

export async function POST(request: NextRequest) {
  console.log('API route: POST /api/documents/upload called');
  
  try {
    // Check if the request is a form data request
    if (!request.headers.get('content-type')?.includes('multipart/form-data')) {
      console.error('Invalid content type for upload', request.headers.get('content-type'));
      return NextResponse.json(
        { error: 'Invalid request format. Must be multipart/form-data' },
        { status: 400 }
      );
    }
    
    // Get the form data
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const userId = formData.get('userId') as string;
    
    console.log(`Processing upload for user ${userId || 'unknown'}, file: ${file?.name || 'none'}, size: ${file ? Math.round(file.size/1024/1024) : 0}MB`);
    
    // Validate request data
    if (!file) {
      console.error('No file provided in upload request');
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }
    
    if (!userId) {
      console.error('No userId provided in upload request');
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 }
      );
    }
    
    // Check for large files that might fail with Vercel's serverless functions
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024 * 0.8) { // 80% of the max as a warning threshold
      console.warn(`File size (${Math.round(file.size/1024/1024)}MB) is approaching or exceeding serverless limits`);
      // We continue processing but log the warning
    }
    
    // Process the document
    console.log(`Calling processDocument for file: ${file.name}, size: ${Math.round(file.size/1024)}KB`);
    const document = await processDocument(file, userId);
    
    console.log(`Document processed successfully, ID: ${document.id}`);
    return NextResponse.json({ success: true, document });
  } catch (error) {
    console.error('Error processing upload:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    // For payload too large errors (413), provide a helpful message about direct uploads
    if (errorMessage.includes('413') || errorMessage.toLowerCase().includes('payload too large')) {
      return NextResponse.json(
        { 
          error: `File is too large for serverless functions. Please use the direct upload method for files larger than 4MB.`,
          code: 'PAYLOAD_TOO_LARGE'
        },
        { status: 413 }
      );
    }
    
    return NextResponse.json(
      { error: `Failed to process document: ${errorMessage}` },
      { status: 500 }
    );
  }
}