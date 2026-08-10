/* ==========================================================================
   Ciudadano Ready | Supabase connection
   Project: "Citizenship Course" (Morfa org)
   The anon/publishable key below is safe to expose in client-side code;
   it's restricted by the Row Level Security policies set on each table.
   ========================================================================== */
const SUPABASE_URL = 'https://uhliqtdsvntkwswjkdqv.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_-nHF2y4qYjNtEHcryN4TCQ_X-lB2ixl';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
