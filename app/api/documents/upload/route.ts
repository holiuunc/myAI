import { NextRequest, NextResponse } from 'next/server';
import { processDocument } from '@/utilities/documents';

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
    
    console.log(`Processing upload for user ${userId || 'unknown'}, file: ${file?.name || 'none'}`);
    
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
    
    // Process the document
    console.log(`Calling processDocument for file: ${file.name}, size: ${Math.round(file.size/1024)}KB`);
    const document = await processDocument(file, userId);
    
    console.log(`Document processed successfully, ID: ${document.id}`);
    return NextResponse.json({ success: true, document });
  } catch (error) {
    console.error('Error processing upload:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return NextResponse.json(
      { error: `Failed to process document: ${errorMessage}` },
      { status: 500 }
    );
  }
}