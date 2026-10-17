// EMN — postulacion-airtable Edge Function
//
// Copia cada postulación del botón "Postula" (tabla `postulaciones` de Supabase)
// a la tabla "Students Info" de Airtable, igual que hace la automatización de
// Airtable con el Google Form. Se llama desde un Database Webhook (INSERT en
// `postulaciones`), no desde el navegador.
//
// Secrets (el proyecto ya tiene AIRTABLE_TOKEN / AIRTABLE_BASE_ID / AIRTABLE_TABLE):
//   supabase secrets set POSTULACION_WEBHOOK_SECRET=<cadena-larga-aleatoria> --project-ref gpoddvcrsdkpgfmyniqu
//
// Deploy (sin verificación de JWT: el webhook no envía sesión, se protege con el secret):
//   supabase functions deploy postulacion-airtable --no-verify-jwt --project-ref gpoddvcrsdkpgfmyniqu
//
// Database Webhook (Supabase → Database → Webhooks): tabla public.postulaciones,
// evento INSERT, tipo Supabase Edge Function "postulacion-airtable", y en los
// headers: x-webhook-secret: <el mismo valor de POSTULACION_WEBHOOK_SECRET>.
//
// Mapeo a Students Info (mismos nombres que usa el Google Form):
//   nombre    -> Name
//   correo    -> Students Email
//   whatsapp  -> Cell Number
//   video     -> Video Performance
// Lo demás (Instrument, Country, Status…) queda vacío para completarlo después.
//
// Nota: si la misma persona ya llenó el Google Form, puede quedar duplicada en
// Students Info. Revisar antes de asignarle profesor.

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const secret = Deno.env.get('POSTULACION_WEBHOOK_SECRET');
  if (!secret || req.headers.get('x-webhook-secret') !== secret) return json({ error: 'Unauthorized' }, 401);

  const token = Deno.env.get('AIRTABLE_TOKEN');
  const base = Deno.env.get('AIRTABLE_BASE_ID');
  const table = Deno.env.get('AIRTABLE_TABLE') || 'Students Info';
  if (!token || !base) return json({ error: 'Airtable no está configurado (faltan AIRTABLE_TOKEN / AIRTABLE_BASE_ID).' }, 500);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }

  // Solo nos interesan inserts en la tabla de postulaciones.
  if (body?.type !== 'INSERT' || body?.table !== 'postulaciones' || !body?.record) return json({ ok: true, skipped: true });

  const r = body.record;
  const fields = {
    'Name': String(r.nombre ?? '').trim(),
    'Students Email': String(r.correo ?? '').trim(),
    'Cell Number': String(r.whatsapp ?? '').trim(),
    'Video Performance': String(r.video ?? '').trim(),
  };

  const api = `https://api.airtable.com/v0/${base}/${encodeURIComponent(table)}`;
  const res = await fetch(api, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields, typecast: true }),
  });
  if (!res.ok) return json({ error: `Airtable ${res.status}: ${(await res.text()).slice(0, 300)}` }, 502);

  const rec = await res.json();
  return json({ ok: true, airtable_id: rec.id });
});
