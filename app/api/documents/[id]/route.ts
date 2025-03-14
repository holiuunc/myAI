import { NextResponse } from 'next/server';
import { deleteDocument } from '@/utilities/documents';
import { getAuthenticatedUser } from '@/middleware/auth';

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } }
) {
  // Get the authenticated user first
  const user = await getAuthenticatedUser();
  
  if (!user) {
    return NextResponse.json(
      { error: 'Authentication required' },
      { status: 401 }
    );
  }
  
  const id = params.id;
  
  // Check if this is a force delete (from URL search params)
  const { searchParams } = new URL(req.url);
  const forceDelete = searchParams.get('force') === 'true';
  
  console.log(`API route: DELETE /api/documents/${id} called (force: ${forceDelete}) by user ${user.id}`);
  
  try {
    // Pass the user ID to the deleteDocument function
    await deleteDocument(id, user.id, forceDelete);
    console.log(`Successfully deleted document with ID: ${id}`);
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