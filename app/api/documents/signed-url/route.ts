import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/configuration/supabase';
import { getAuthenticatedUser } from '@/middleware/auth';

export async function POST(request: Request) {
  const user = await getAuthenticatedUser();
  
  if (!user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  
  try {
    const { fileName, contentType } = await request.json();
    
    // Create a signed URL for uploading to Supabase Storage
    const { data, error } = await supabaseAdmin.storage
      .from('documents')
      .createSignedUploadUrl(`${user.id}/${fileName}`);
    
    if (error) throw error;
    
    return NextResponse.json({
      signedUrl: data.signedUrl,
      path: data.path,
      token: data.token,
      filePath: `${user.id}/${fileName}`
    });
  } catch (error) {
    console.error('Error creating signed URL:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create upload URL' }, 
      { status: 500 }
    );
  }
}