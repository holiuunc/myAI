import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/configuration/supabase';
import { v4 as uuidv4 } from 'uuid';

export async function POST(request: Request) {
  try {
    console.log("Login endpoint called");
    
    // Parse request body
    // biome-ignore lint/suspicious/noImplicitAnyLet: <explanation>
            let emailData;
    try {
      emailData = await request.json();
      console.log("Request data:", emailData);
    } catch (e) {
      console.error("Failed to parse request body:", e);
      return NextResponse.json({ error: 'Invalid request format' }, { status: 400 });
    }
    
    const { email } = emailData;
    
    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'Valid email is required' }, { status: 400 });
    }
    
    // Verify Supabase connection
    console.log("Checking Supabase connection...");
    try {
      // Simple test query
      const { error: connectionError } = await supabaseAdmin
        .from('profiles')
        .select('count')
        .limit(1);
        
      if (connectionError) {
        console.error("Supabase connection error:", connectionError);
        throw new Error('Database connection failed');
      }
    } catch (e) {
      console.error("Supabase test query failed:", e);
      return NextResponse.json({ error: 'Database connection error' }, { status: 500 });
    }
    
    // Check if user exists
    console.log("Looking up user:", email);
    // biome-ignore lint/suspicious/noImplicitAnyLet: <explanation>
    let user;
    try {
      const { data, error } = await supabaseAdmin
        .from('profiles')
        .select('id, email')
        .eq('email', email.toLowerCase())
        .single();
      
      if (error && error.code !== 'PGRST116') { // Not found is OK
        console.error("User lookup error:", error);
        throw error;
      }
      
      user = data;
      console.log("User lookup result:", user ? "Found" : "Not found");
    } catch (e) {
      console.error("User query failed:", e);
      return NextResponse.json({ error: 'Error looking up user account' }, { status: 500 });
    }
    
    // Create user if needed
    if (!user) {
      console.log("Creating new user");
      const userId = uuidv4();
      
      try {
        // Then create the profile record
        const { error: profileError } = await supabaseAdmin
          .from('profiles')
          .insert([{ id: userId, email: email.toLowerCase() }]);
          
        if (profileError) {
          console.error("Profile creation error:", profileError);
          throw profileError;
        }
        
        user = { id: userId, email: email.toLowerCase() };
        console.log("New user created");
      } catch (e) {
        console.error("User creation failed:", e);
        return NextResponse.json({ error: 'Failed to create user account' }, { status: 500 });
      }
    }
    
    // Check for existing valid session
    const { data: existingSession } = await supabaseAdmin
      .from('sessions')
      .select('id')
      .eq('user_id', user.id)
      .gt('expires_at', new Date().toISOString())
      .order('expires_at', { ascending: false })
      .limit(1);
    
    // biome-ignore lint/suspicious/noImplicitAnyLet: <explanation>
    let sessionId;
    
    if (existingSession && existingSession.length > 0) {
      // Update existing session expiry
      sessionId = existingSession[0].id;
      await supabaseAdmin
        .from('sessions')
        .update({
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
        })
        .eq('id', sessionId);
        
      console.log("Existing session updated:", sessionId);
    } else {
      // Create new session
      sessionId = uuidv4();
      await supabaseAdmin
        .from('sessions')
        .insert([{
          id: sessionId,
          user_id: user.id,
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
        }]);
        
      console.log("New session created:", sessionId);
    }
    
    // Set cookie with correct settings for your environment
    cookies().set('session_id', sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax', // Changed from strict for better compatibility
      path: '/',
      maxAge: 60 * 60 * 24 * 7 // 7 days
    });

    // In login route
    console.log("Setting session cookie:", sessionId);
    
    console.log("Login response data:", { sessionId, user });
    return NextResponse.json({ success: true, user: { id: user.id, email: user.email } });
  } catch (error) {
    console.error("Unhandled login error:", error);
    return NextResponse.json({ error: 'Authentication failed' }, { status: 500 });
  }
}