// EMN — mock-audition-report Edge Function
//
// Envía al alumno, por correo, el PDF del Mock Audition Evaluation Report que admin/profesor generó
// en /mock-audition-test (el PDF ya está subido al bucket privado "mock-reports").
//
// Usa los mismos secrets que mock-audition-email (RESEND_API_KEY, MAIL_FROM, MAIL_REPLY_TO).
// Deploy:  supabase functions deploy mock-audition-report --project-ref gpoddvcrsdkpgfmyniqu
//
// POST { evaluacion_id, filename? } -> { ok: true } | { ok: false, error }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { encodeBase64 } from 'https://deno.land/std@0.224.0/encoding/base64.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'Missing Authorization header' }, 401);

  const url = Deno.env.get('SUPABASE_URL')!;
  const callerClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !user) return json({ error: 'Invalid session' }, 401);

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: me } = await admin.from('students').select('role').eq('id', user.id).maybeSingle();
  if (me?.role !== 'admin' && me?.role !== 'professor') return json({ error: 'Not allowed' }, 403);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }

  const { data: ev } = await admin.from('mock_evaluaciones').select('*').eq('id', body.evaluacion_id).maybeSingle();
  if (!ev) return json({ ok: false, error: 'No encontré esa evaluación.' });
  if (!ev.pdf_path) return json({ ok: false, error: 'La evaluación todavía no tiene PDF.' });

  const { data: al } = await admin.from('alumnos').select('nombre, correo').eq('id', ev.alumno_id).maybeSingle();
  if (!al?.correo) return json({ ok: false, error: `${al?.nombre || 'El alumno'} no tiene correo guardado: agrégalo en Comunidad.` });

  const { data: file, error: dlErr } = await admin.storage.from('mock-reports').download(ev.pdf_path);
  if (dlErr || !file) return json({ ok: false, error: 'No pude leer el PDF guardado.' });

  const key = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('MAIL_FROM');
  if (!key || !from) return json({ ok: false, error: 'El correo no está configurado (faltan los secrets RESEND_API_KEY / MAIL_FROM).' });

  const filename = String(body.filename || 'EMN-Mock-Audition-Report.pdf').replace(/[^\w.\-]+/g, '_');
  const nombre = al.nombre.split(' ')[0];

  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#f4f5f6;font-family:Arial,Helvetica,sans-serif;color:#111">
<div style="max-width:560px;margin:0 auto;padding:24px">
  <div style="background:#fff;border-radius:10px;overflow:hidden;border:1px solid #d8dbdf">
    <div style="background:#c8102e;color:#fff;padding:18px 24px;font-size:18px;font-weight:700">Berklee Mock Audition · EMN</div>
    <div style="padding:24px;line-height:1.55;font-size:15px">
      <p style="margin:0 0 14px">Hola ${esc(nombre)},</p>
      <p style="margin:0 0 14px">Gracias por participar en el <strong>Berklee Mock Audition</strong>. Adjuntamos tu <strong>Mock Audition Evaluation Report</strong> en PDF, con tus puntajes, fortalezas y áreas de mejora.</p>
      <p style="margin:0 0 14px">Revísalo con calma y llévalo a tu próxima clase para trabajar los puntos de mejora con tu profesor.</p>
      <p style="margin:0">¡Sigue adelante!<br>Equipo EMN</p>
    </div>
  </div>
</div></body></html>`;
  const text = `Hola ${nombre},\n\nGracias por participar en el Berklee Mock Audition. Adjuntamos tu Mock Audition Evaluation Report en PDF, con tus puntajes, fortalezas y áreas de mejora.\n\nRevísalo con calma y llévalo a tu próxima clase para trabajar los puntos de mejora con tu profesor.\n\nEquipo EMN`;

  const payload: Record<string, unknown> = {
    from, to: [al.correo], subject: 'Tu Mock Audition Evaluation Report · EMN', html, text,
    attachments: [{ filename, content: encodeBase64(new Uint8Array(await file.arrayBuffer())) }],
  };
  const reply = Deno.env.get('MAIL_REPLY_TO');
  if (reply) payload.reply_to = reply;

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!r.ok) return json({ ok: false, error: `Resend ${r.status}: ${(await r.text()).slice(0, 300)}` });

  await admin.from('mock_evaluaciones').update({ enviado_at: new Date().toISOString() }).eq('id', ev.id);
  return json({ ok: true });
});
