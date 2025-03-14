import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/middleware/auth';  // Updated path

export async function GET() {
  const user = await getAuthenticatedUser();
  return NextResponse.json({ user });
}