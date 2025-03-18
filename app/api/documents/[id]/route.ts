import { NextResponse } from 'next/server';
import { deleteDocument } from '@/utilities/documents';

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } }
) {
  const id = params.id;
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('userId');
  const forceDelete = searchParams.get('force') === 'true';
  
  // console.log(`API route: DELETE /api/documents/${id} called - userId: ${userId || 'not provided'}, force: ${forceDelete}`);
  
  if (!userId) {
    return NextResponse.json(
      { error: 'User ID is required' },
      { status: 400 }
    );
  }
  
  try {
    // Pass the user ID to the deleteDocument function
    // console.log(`Attempting to delete document ${id} for user ${userId}`);
    await deleteDocument(id, userId, forceDelete);
    // console.log(`Successfully deleted document with ID: ${id}`);
    return NextResponse.json({ success: true, id });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`API route error: ${errorMessage}`);
    return NextResponse.json(
      { error: `Failed to delete document: ${errorMessage}` }, 
      { status: 500 }
    );
  }
}