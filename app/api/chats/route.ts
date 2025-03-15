import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/middleware/auth';
import { supabaseAdmin } from '@/configuration/supabase';

// Get chat history for authenticated user
export async function GET() {
  const user = await getAuthenticatedUser();
  
  if (!user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  
  try {
    const { data, error } = await supabaseAdmin
      .from('chats')
      .select('messages')
      .eq('user_id', user.id)
      .single();
    
    if (error && error.code !== 'PGRST116') { // Not found is okay
      throw error;
    }
    
    return NextResponse.json({ 
      messages: data?.messages || [] 
    });
  } catch (error) {
    console.error('Failed to fetch chat history:', error);
    return NextResponse.json(
      { error: 'Failed to fetch chat history' }, 
      { status: 500 }
    );
  }
}

// Save chat history
export async function POST(req: Request) {
  const user = await getAuthenticatedUser();
  
  if (!user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  
  try {
    const { messages } = await req.json();
    
    console.log("Attempting to upsert chat for user:", user.id);
    console.log("Messages count:", Array.isArray(messages) ? messages.length : 'not an array');
    
    const { error } = await supabaseAdmin
      .from('chats')
      .upsert({
        user_id: user.id,
        messages,
        updated_at: new Date()
      }, {
        onConflict: 'user_id'
      });
      
    if (error) {
      console.error("Supabase error details:", error);
      throw error;
    }
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to save chat history:', error);
    // Include more error details in the response during development
    return NextResponse.json({
      error: 'Failed to save chat history',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}