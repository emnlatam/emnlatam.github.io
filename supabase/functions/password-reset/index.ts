// EMN — password-reset Edge Function
//
// Lo llama /emn-login (sin sesión) para "¿Olvidaste tu contraseña?". Solo trabaja con correos que
// existen en la tabla `students` (personas invitadas); a cualquier otro le responde registered:false
// y no se envía nada. Se hace aquí y no en el navegador para no exponer la lista de correos ni
// permitir saltarse la verificación.
//
// Deploy:  supabase functions deploy password-reset --project-ref gpoddvcrsdkpgfmyniqu
//
// Límite: 4 intentos por hora y por IP (un correo no registrado o un envío de link cuenta como 1; verificar
// un correo registrado no cuenta). Con 4, responde { blocked: true, retry_min } sin consultar nada.
//
// POST { email, action: 'check' | 'send' }
//   check -> { registered: boolean, left?: number }
//   send  -> { registered: false, left? }               (no enviado)
//          | { registered: true, ok: true }             (link enviado)
//          | { registered: true, ok: false, error }     (falló el envío, p. ej. límite de correos)
//   cualquiera -> { blocked: true, retry_min }          (demasiados intentos)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const REDIRECT_TO = 'https://emnlatam.github.io/emn-login';   // debe estar en Redirect URLs de Supabase
const MAX_INTENTOS = 4;
const VENTANA_MS = 60 * 60 * 1000;   // 1 hora

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

  // Quién llama: la IP que pone la plataforma (no se puede falsificar desde el navegador).
  const ip = (req.headers.get('cf-connecting-ip') || (req.headers.get('x-forwarded-for') || '').split(',')[0] || 'unknown').trim();
  const desde = new Date(Date.now() - VENTANA_MS).toISOString();
  const { data: recientes, error: recErr } = await admin.from('password_reset_intentos')
    .select('created_at').eq('ip', ip).gte('created_at', desde).order('created_at', { ascending: true });
  if (recErr) { console.error(recErr); return json({ error: 'Lookup failed' }, 500); }
  if (recientes.length >= MAX_INTENTOS) {
    // se libera cuando el intento que hace pasar el conteo de 4 cumple su hora
    const libera = new Date(recientes[recientes.length - MAX_INTENTOS].created_at).getTime() + VENTANA_MS;
    return json({ blocked: true, retry_min: Math.max(1, Math.ceil((libera - Date.now()) / 60000)) });
  }
  const registrar = (motivo: 'denegado' | 'envio') => admin.from('password_reset_intentos').insert({ ip, motivo });
  const left = (extra: number) => Math.max(0, MAX_INTENTOS - recientes.length - extra);
  admin.from('password_reset_intentos').delete().lt('created_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString()).then(() => {});

  // ilike sin comodines: se escapan \ % _ para que "_" del correo no coincida con cualquier letra.
  const pattern = email.replace(/[\\%_]/g, (c) => '\\' + c);
  const { data: row, error } = await admin.from('students').select('id').ilike('email', pattern).limit(1).maybeSingle();
  if (error) { console.error(error); return json({ error: 'Lookup failed' }, 500); }
  if (!row) { await registrar('denegado'); return json({ registered: false, left: left(1) }); }

  if (body.action === 'check') return json({ registered: true });

  await registrar('envio');
  const anon = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!);
  const { error: sendErr } = await anon.auth.resetPasswordForEmail(email, { redirectTo: REDIRECT_TO });
  if (sendErr) {
    console.error(sendErr);
    const limited = (sendErr as any).status === 429 || /rate limit/i.test(sendErr.message);
    return json({ registered: true, ok: false, error: limited ? 'rate' : 'send' });
  }
  return json({ registered: true, ok: true });
});
