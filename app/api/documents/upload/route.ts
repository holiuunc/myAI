import { NextResponse } from 'next/server';
import { processDocument } from '@/utilities/documents';
import { getAuthenticatedUser } from '@/middleware/auth';

export async function POST(request: Request) {
  // Get authenticated user
  const user = await getAuthenticatedUser();
  
  if (!user) {
    return NextResponse.json(
      { error: 'Authentication required' },
      { status: 401 }
    );
  }
  
  // Process form data and upload document
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    
    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }
    
    const document = await processDocument(file, user.id);
    
    return NextResponse.json({ document });
  } catch (error) {
    console.error('Error uploading document:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Upload failed' },
      { status: 500 }
    );
  }
}