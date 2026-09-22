/* ==========================================================================
   Ciudadano Ready | Supabase connection
   Project: "Citizenship Course" (Morfa org)
   The anon/publishable key below is safe to expose in client-side code;
   it's restricted by the Row Level Security policies set on each table.
   ========================================================================== */
const SUPABASE_URL = 'https://uhliqtdsvntkwswjkdqv.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_-nHF2y4qYjNtEHcryN4TCQ_X-lB2ixl';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---- Edge Function error message helper --------------------------------
// supabase-js's functions.invoke() does NOT parse the response body when an
// Edge Function returns a non-2xx status -- it just throws a generic
// FunctionsHttpError ("Edge Function returned a non-2xx status code") and
// leaves `data` as null, even though our functions always send back a real,
// specific { error: "..." } JSON body (e.g. "An account with that email
// already exists. Try logging in instead."). The actual body is only
// reachable via error.context, the raw fetch Response object, which has to
// be read manually. This helper does that read so callers can show the
// real reason instead of the generic wrapper message. Used everywhere
// functions.invoke() is called across app.js/member.js/admin.js.
async function getEdgeFunctionErrorMessage(error, fallback) {
  if (!error) return fallback;
  const response = error.context;
  if (response && typeof response.json === 'function') {
    try {
      const body = await response.clone().json();
      if (body && typeof body.error === 'string' && body.error.trim()) return body.error;
    } catch (_) {
      // Body wasn't JSON (or already consumed) -- fall through to text/message below.
    }
    try {
      const text = await response.text();
      if (text && text.trim()) return text;
    } catch (_) {
      // Nothing left to try -- fall through to the generic message.
    }
  }
  return (error.message && error.message.trim()) || fallback;
}
