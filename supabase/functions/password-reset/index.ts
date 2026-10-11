// EMN — password-reset Edge Function
//
// Lo llama /emn-login (sin sesión) para "¿Olvidaste tu contraseña?". Solo trabaja con correos que
// existen en la tabla `students` (personas invitadas); a cualquier otro le responde registered:false
// y no se envía nada. Se hace aquí y no en el navegador para no exponer la lista de correos ni
// permitir saltarse la verificación.
//
// Deploy:  supabase functions deploy password-reset --project-ref gpoddvcrsdkpgfmyniqu
//
// POST { email, action: 'check' | 'send' }
//   check -> { registered: boolean }
//   send  -> { registered: false }                       (no enviado)
//          | { registered: true, ok: true }              (link enviado)
//          | { registered: true, ok: false, error }      (falló el envío, p. ej. límite de correos)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const REDIRECT_TO = 'https://emnlatam.github.io/emn-login';   // debe estar en Redirect URLs de Supabase

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }

  const email = typeof body.email === 'string' ? body.email.trim() : '';
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ registered: false });
  if (body.action !== 'check' && body.action !== 'send') return json({ error: 'Invalid action' }, 400);

  const url = Deno.env.get('SUPABASE_URL')!;
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // ilike sin comodines: se escapan \ % _ para que "_" del correo no coincida con cualquier letra.
  const pattern = email.replace(/[\\%_]/g, (c) => '\\' + c);
  const { data: row, error } = await admin.from('students').select('id').ilike('email', pattern).limit(1).maybeSingle();
  if (error) { console.error(error); return json({ error: 'Lookup failed' }, 500); }
  if (!row) return json({ registered: false });

  if (body.action === 'check') return json({ registered: true });

  const anon = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!);
  const { error: sendErr } = await anon.auth.resetPasswordForEmail(email, { redirectTo: REDIRECT_TO });
  if (sendErr) {
    console.error(sendErr);
    const limited = (sendErr as any).status === 429 || /rate limit/i.test(sendErr.message);
    return json({ registered: true, ok: false, error: limited ? 'rate' : 'send' });
  }
  return json({ registered: true, ok: true });
});
