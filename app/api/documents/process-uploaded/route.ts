import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/middleware/auth';
import { supabaseAdmin } from '@/configuration/supabase';
import { processUploadedDocument } from '@/utilities/documents';

export async function POST(request: Request) {
  const user = await getAuthenticatedUser();
  
  if (!user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  
  try {
    const { filePath } = await request.json();
    
    // Download the file from Supabase Storage first
    const { data, error } = await supabaseAdmin.storage
      .from('documents')
      .download(filePath);
      
    if (error) throw error;
    if (!data) throw new Error('No file data returned from storage');
    
    // Process the file with existing logic
    const document = await processUploadedDocument(data, filePath, user.id);
    
    return NextResponse.json({ document });
  } catch (error) {
    console.error('Error processing uploaded file:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Processing failed' }, 
      { status: 500 }
    );
  }
}