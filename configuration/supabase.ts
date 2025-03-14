import { createClient } from '@supabase/supabase-js';

// biome-ignore lint/style/noNonNullAssertion: <explanation>
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
// biome-ignore lint/style/noNonNullAssertion: <explanation>
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabaseAdmin = createClient(supabaseUrl, supabaseKey);