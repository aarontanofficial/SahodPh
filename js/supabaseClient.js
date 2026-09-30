// js/supabaseClient.js
//
// The "anon" public key below is SAFE to expose in public JS -
// it is not a secret. Supabase's security model relies on Row Level
// Security (RLS) policies in the database, not on hiding this key.
// NEVER put your "service_role" key here - that one is secret.

const SUPABASE_URL = 'https://cjpxzocqxnhkxcsjhwgb.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNqcHh6b2NxeG5oa3hjc2pod2diIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAxNTYwMTAsImV4cCI6MjEwNTczMjAxMH0.AgDHtG8Vh92AL5h6e5NbvV_4d8TiQyN0m2h46Bm8-dU';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
