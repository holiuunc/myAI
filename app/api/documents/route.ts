import { NextResponse } from 'next/server';
import { getDocuments } from '@/utilities/documents';
import { getAuthenticatedUser } from '@/middleware/auth';

export async function GET() {
  // Get the authenticated user
  const user = await getAuthenticatedUser();
  
  if (!user) {
    return NextResponse.json(
      { error: 'Authentication required' },
      { status: 401 }
    );
  }
  
  try {
    // Pass the user ID to getDocuments
    const documents = await getDocuments(user.id);
    return NextResponse.json({ documents });
  } catch (error) {
    console.error('Error fetching documents:', error);
    return NextResponse.json(
      { error: 'Failed to fetch documents' },
      { status: 500 }
    );
  }
}