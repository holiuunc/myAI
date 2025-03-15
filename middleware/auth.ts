import { cookies } from 'next/headers';
import { supabaseAdmin } from '@/configuration/supabase';

export async function getAuthenticatedUser() {
  const sessionId = cookies().get('session_id')?.value;
  
  if (!sessionId) {
    return null;
  }
  
  try {
    // Get valid session
    const { data: session } = await supabaseAdmin
      .from('sessions')
      .select('user_id, expires_at')
      .eq('id', sessionId)
      .single();
    
    if (!session || new Date(session.expires_at) < new Date()) {
      // Session expired or not found
      cookies().delete('session_id');
      return null;
    }
    
    // Get user data - FIXED: Use profiles not users
    const { data: user } = await supabaseAdmin
      .from('profiles')  // Changed from 'users' to 'profiles'
      .select('id, email')
      .eq('id', session.user_id)
      .single();
    
    return user ? { id: user.id, email: user.email } : null;
  } catch (error) {
    console.error('Session validation error:', error);
    return null;
  }
}