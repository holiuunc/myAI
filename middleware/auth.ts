import { cookies } from 'next/headers';
import { supabaseAdmin } from '@/configuration/supabase';

export async function getAuthenticatedUser() {
  const sessionId = cookies().get('session_id')?.value;
  console.log("Auth check - Session ID:", sessionId ? "Found" : "Not found");
  
  if (!sessionId) {
    return null;
  }
  
  try {
    // Get valid session
    const { data: session, error } = await supabaseAdmin
      .from('sessions')
      .select('user_id, expires_at')
      .eq('id', sessionId)
      .single();
    
    if (error) {
      console.error("Session query error:", error);
      return null;
    }
    
    if (!session || new Date(session.expires_at) < new Date()) {
      // Session expired or not found
      console.log("Session expired or not found");
      cookies().delete('session_id');
      return null;
    }
    
    const { data: user, error: userError } = await supabaseAdmin
      .from('profiles')
      .select('id, email')
      .eq('id', session.user_id)
      .single();
    
    if (userError) {
      console.error("User query error:", userError);
      return null;
    }
    
    console.log("User authenticated:", user?.email);
    return user ? { id: user.id, email: user.email } : null;
  } catch (error) {
    console.error('Session validation error:', error);
    return null;
  }
}