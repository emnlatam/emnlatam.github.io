// EMN — delete-student Edge Function
//
// Called by /usuarios (as an authenticated Admin) to delete a person: removes
// their Supabase Auth account, which cascades to their `students` row and
// everything hanging off it (practice time, Interview Prep answers, Career
// Progress, course access/progress). Rows in `alumnos`, `mock_slots` and
// `mock_evaluaciones` only lose their link to the account (SET NULL) — the
// student's file, their booked slots and their evaluation reports stay.
//
// Deleting an auth account requires the service_role key, so this has to run
// here and not in the browser. Deploy with:
//   supabase functions deploy delete-student --project-ref gpoddvcrsdkpgfmyniqu
//
// POST { user_id } -> { ok: true } | { error }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'Missing Authorization header' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const callerClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user: caller }, error: callerErr } = await callerClient.auth.getUser();
  if (callerErr || !caller) return json({ error: 'Invalid session' }, 401);

  const adminClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: callerRow, error: roleErr } = await adminClient.from('students').select('role').eq('id', caller.id).maybeSingle();
  // If the lookup itself fails (e.g. bad SUPABASE_SERVICE_ROLE_KEY) say so, instead of a misleading "Admins only".
  if (roleErr) return json({ error: `No se pudo verificar el rol: ${roleErr.message}` }, 500);
  if (callerRow?.role !== 'admin') return json({ error: 'Admins only' }, 403);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }

  const userId = body?.user_id;
  if (!userId || typeof userId !== 'string') return json({ error: 'user_id is required' }, 400);
  if (userId === caller.id) return json({ error: 'No puedes eliminar tu propia cuenta.' }, 400);

  const { error: delErr } = await adminClient.auth.admin.deleteUser(userId);
  if (delErr) {
    // A person who was invited but never opened the link only has a `students`
    // row if the auth user exists, so a missing auth user means a stray row: clean it.
    if (/not found/i.test(delErr.message)) {
      await adminClient.from('students').delete().eq('id', userId);
      return json({ ok: true });
    }
    return json({ error: `No se pudo eliminar: ${delErr.message}` }, 400);
  }
  return json({ ok: true });
});
