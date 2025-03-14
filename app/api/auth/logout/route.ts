import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/configuration/supabase';

export async function POST() {
  const sessionId = cookies().get('session_id')?.value;
  
  if (sessionId) {
    // Delete session from database
    await supabaseAdmin
      .from('sessions')
      .delete()
      .eq('id', sessionId);
    
    // Clear cookie
    cookies().delete('session_id');
  }
  
  return NextResponse.json({ success: true });
}