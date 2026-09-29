// js/supabaseClient.js
//
// The "anon" public key below is SAFE to expose in public JS -
// it is not a secret. Supabase's security model relies on Row Level
// Security (RLS) policies in the database, not on hiding this key.
// NEVER put your "service_role" key here - that one is secret.

const SUPABASE_URL = 'https://cjpxzocqxnhkxcsjhwgb.supabase.co';
const SUPABASE_ANON_KEY = 'PASTE_YOUR_ANON_PUBLIC_KEY_HERE';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
