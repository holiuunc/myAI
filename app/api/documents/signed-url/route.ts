import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/configuration/supabase';
import { v4 as uuidv4 } from 'uuid';

export async function POST(request: Request) {
  try {
    // Parse request data from FormData
    const formData = await request.formData();
    const fileName = formData.get('fileName') as string;
    const fileType = formData.get('fileType') as string;
    const userId = formData.get('userId') as string;
    
    // Validate request data
    if (!fileName || !userId) {
      return NextResponse.json(
        { error: 'File name and user ID are required' },
        { status: 400 }
      );
    }
    
    // Generate a unique path for the file in Supabase Storage
    const filePath = `${userId}/${uuidv4()}-${fileName}`;
    
    // Get a signed URL for direct upload to Supabase Storage
    const { data, error } = await supabaseAdmin.storage
      .from('documents')
      .createSignedUploadUrl(filePath);
      
    if (error) {
      console.error('Error generating signed URL:', error);
      return NextResponse.json(
        { error: `Failed to generate signed URL: ${error.message}` },
        { status: 500 }
      );
    }
    
    // Return the signed URL and file path
    return NextResponse.json({
      signedUrl: data.signedUrl,
      filePath: data.path
    });
  } catch (error) {
    console.error('Error generating signed URL:', error);
    return NextResponse.json(
      { error: `Failed to generate signed URL: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 }
    );
  }
}