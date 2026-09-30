// js/supabaseClient.js
//
// The publishable key below is SAFE to expose in public JS -
// it is not a secret. Supabase's security model relies on Row Level
// Security (RLS) policies in the database, not on hiding this key.
// NEVER put your "service_role" / secret key here.

const SUPABASE_URL = 'https://cjpxzocqxnhkxcsjhwgb.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_bt7p6ECRh_ULtOmTmHIS-A_WbDVkrMG';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
