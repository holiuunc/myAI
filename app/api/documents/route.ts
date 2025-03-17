import { NextResponse } from 'next/server';
import { getDocuments } from '@/utilities/documents';

export async function GET(request: Request) {
  // Extract userId from the query parameters
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId');
  
  console.log(`API route: GET /api/documents called with userId: ${userId || 'not provided'}`);
  
  if (!userId) {
    return NextResponse.json(
      { error: 'User ID is required', documents: [] },
      { status: 400 }
    );
  }
  
  try {
    // Pass the user ID to getDocuments
    console.log(`Fetching documents for user: ${userId}`);
    const documents = await getDocuments(userId);
    console.log(`Found ${documents.length} documents for user ${userId}`);
    return NextResponse.json({ documents });
  } catch (error) {
    console.error('Error fetching documents:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: `Failed to fetch documents: ${errorMessage}`, documents: [] },
      { status: 500 }
    );
  }
}