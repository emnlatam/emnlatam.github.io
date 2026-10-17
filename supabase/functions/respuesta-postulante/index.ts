// EMN — respuesta-postulante Edge Function
//
// Se dispara cuando llega una postulación nueva a pregrado (Google Form vía
// Airtable, o el botón "Postula" de la web). Hace dos cosas:
//   1) Envía el correo de "recibimos tu postulación" al postulante, desde
//      admisiones@emnperu.com, usando la API de Zoho Mail (no Gmail ni Zapier).
//   2) Guarda una alerta en la tabla `alertas` para el tablero visual.
//
// Llamada (POST JSON, con header x-webhook-secret):
//   { "nombre": "...", "correo": "...", "origen": "formulario-pregrado" | "web" }
//
// Secrets (Supabase → Edge Functions → Secrets, o supabase secrets set):
//   RESPUESTA_WEBHOOK_SECRET   cadena larga aleatoria (la misma que pone el webhook)
//   ZOHO_CLIENT_ID             del "Self Client" creado en Zoho API Console
//   ZOHO_CLIENT_SECRET         del mismo Self Client
//   ZOHO_REFRESH_TOKEN         refresh token generado con scope ZohoMail.messages.CREATE
//   ZOHO_ACCOUNT_ID            ID de la cuenta de correo admisiones@emnperu.com (GET /api/accounts)
//   ZOHO_DOMAIN                opcional, por defecto "zoho.com" (usa zoho.eu / zoho.in / etc. si la cuenta está en otra región)
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (ya los pone Supabase)
//
// Deploy (sin JWT: lo protege x-webhook-secret):
//   supabase functions deploy respuesta-postulante --no-verify-jwt --project-ref gpoddvcrsdkpgfmyniqu

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const FROM = 'admisiones@emnperu.com';
const SUBJECT = 'Recibimos tu postulación a EMN';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-webhook-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

// Texto aprobado por Daniel (2026-10-14) y firma de Maria Gracia Bustamante.
const bodyHtml = (nombre: string) => `
<div style="font-family: Arial, Helvetica, sans-serif; font-size: 15px; color: #1A1A1A; line-height: 1.5;">
  <p>Hola ${esc(nombre)}!</p>
  <p>Gracias por postularte al programa de pregrado de EMN. Recibimos tu solicitud y ya la estamos revisando.</p>
  <p>Te responderemos a este mismo correo pronto con los siguientes pasos. Mientras tanto, puedes conocernos mejor en <a href="https://emnlatam.com" style="color: #C8102E;">emnlatam.com</a>.</p>
  <p>Saludos cordiales,</p>
  <p style="margin-top: 24px; margin-bottom: 0;"><strong>Maria Gracia Bustamante</strong><br>
  Secretaria | EMN<br>
  admisiones@emnperu.com · (+51) 986 658 866<br>
  <a href="https://academy.emnlatam.com" style="color: #C8102E;">academy.emnlatam.com</a></p>
</div>`;

// Obtiene un access token nuevo de Zoho a partir del refresh token.
async function zohoAccessToken(domain: string): Promise<string> {
  const params = new URLSearchParams({
    refresh_token: Deno.env.get('ZOHO_REFRESH_TOKEN')!,
    client_id: Deno.env.get('ZOHO_CLIENT_ID')!,
    client_secret: Deno.env.get('ZOHO_CLIENT_SECRET')!,
    grant_type: 'refresh_token',
  });
  const r = await fetch(`https://accounts.${domain}/oauth/v2/token?${params}`, { method: 'POST' });
  const data = await r.json();
  if (!r.ok || !data.access_token) throw new Error(`Zoho token ${r.status}: ${JSON.stringify(data).slice(0, 200)}`);
  return data.access_token;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const secret = Deno.env.get('RESPUESTA_WEBHOOK_SECRET');
  if (!secret || req.headers.get('x-webhook-secret') !== secret) return json({ error: 'Unauthorized' }, 401);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }

  const nombre = String(body?.nombre ?? '').trim().slice(0, 120);
  const correo = String(body?.correo ?? '').trim().slice(0, 200);
  const origen = String(body?.origen ?? 'desconocido').slice(0, 60);
  if (nombre.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) return json({ error: 'nombre o correo inválido' }, 400);

  const domain = Deno.env.get('ZOHO_DOMAIN') || 'zoho.com';
  const accountId = Deno.env.get('ZOHO_ACCOUNT_ID');
  if (!accountId) return json({ error: 'Falta ZOHO_ACCOUNT_ID' }, 500);

  // 1) Correo al postulante desde admisiones@emnperu.com.
  let token: string;
  try { token = await zohoAccessToken(domain); } catch (e) { return json({ error: String(e) }, 502); }
  const mail = await fetch(`https://mail.${domain}/api/accounts/${accountId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Zoho-oauthtoken ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fromAddress: FROM, toAddress: correo, subject: SUBJECT, content: bodyHtml(nombre), mailFormat: 'html' }),
  });
  const mailOk = mail.ok;
  const mailErr = mailOk ? null : `Zoho ${mail.status}: ${(await mail.text()).slice(0, 200)}`;

  // 2) Alerta para el tablero visual (tabla `alertas`).
  const url = Deno.env.get('SUPABASE_URL')!;
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: alerta, error: alertaErr } = await admin.from('alertas').insert({
    tipo: 'nueva_postulacion',
    origen,
    nombre,
    correo,
    correo_enviado: mailOk,
    detalle: mailErr,
  }).select('id').single();

  if (alertaErr) return json({ ok: mailOk, correo_enviado: mailOk, alerta_error: alertaErr.message, mail_error: mailErr }, mailOk ? 200 : 502);
  return json({ ok: mailOk, correo_enviado: mailOk, alerta_id: alerta.id, mail_error: mailErr }, mailOk ? 200 : 502);
});
