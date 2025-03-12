import { NextResponse } from 'next/server';
import { deleteDocument } from '@/utilities/documents';

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } }
) {
  const id = params.id;
  console.log(`API route: DELETE /api/documents/${id} called`);
  
  try {
    await deleteDocument(id);
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