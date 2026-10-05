// EMN — mock-audition-email Edge Function
//
// Envía al alumno el correo de confirmación de su slot del Berklee Mock Audition
// (fecha, hora Perú, link de la llamada e instrucciones). La llaman admin/profesor (al agendar) o el propio
// alumno dueño del slot (al reservar él mismo).
//
// Secrets necesarios (una sola vez; la clave sale de resend.com → API Keys, y el dominio debe estar verificado):
//   supabase secrets set RESEND_API_KEY=re_... MAIL_FROM="EMN <admisiones@mail.emnperu.com>" MAIL_REPLY_TO=admisiones@emnperu.com --project-ref gpoddvcrsdkpgfmyniqu
//
// Deploy:  supabase functions deploy mock-audition-email --project-ref gpoddvcrsdkpgfmyniqu
//
// POST { slot_id } -> { ok: true } | { ok: false, error }   (los fallos "esperables" vuelven con 200 y ok:false)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const hora12 = (h: number) => `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? 'a. m.' : 'p. m.'}`;

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
  const isStaff = me?.role === 'admin' || me?.role === 'professor';

  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }

  const { data: slot } = await admin.from('mock_slots').select('*').eq('id', body.slot_id).maybeSingle();
  if (!slot) return json({ ok: false, error: 'No encontré ese slot.' });
  if (!isStaff && slot.student_id !== user.id) return json({ error: 'Not allowed' }, 403);

  const { data: al } = await admin.from('alumnos').select('nombre, correo').eq('id', slot.alumno_id).maybeSingle();
  if (!al?.correo) return json({ ok: false, error: `${al?.nombre || 'El alumno'} no tiene correo guardado: agrégalo en Comunidad.` });

  // Link de la llamada: el de esa fecha; si no hay, el de Mock Audition del Calendario.
  const { data: f } = await admin.from('mock_fechas').select('link').eq('fecha', slot.fecha).maybeSingle();
  let link = f?.link as string | undefined;
  if (!link) {
    const { data: m } = await admin.from('cursos_meet').select('link').eq('curso', 'Mock Audition').maybeSingle();
    link = m?.link;
  }
  if (!link || !/^https?:\/\//i.test(link)) return json({ ok: false, error: 'Falta el link de la llamada de esa fecha.' });

  const key = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('MAIL_FROM');
  if (!key || !from) return json({ ok: false, error: 'El correo no está configurado (faltan los secrets RESEND_API_KEY / MAIL_FROM).' });

  const [y, mo, d] = String(slot.fecha).split('-').map(Number);
  const dow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  const fecha = `${DIAS[dow]} ${d} de ${MESES[mo - 1]} de ${y}`;
  const inicio = hora12(slot.hora), fin = hora12(slot.hora + 1);
  const nombre = esc(al.nombre.split(' ')[0]);
  const safeLink = esc(link);

  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#f4f5f6;font-family:Arial,Helvetica,sans-serif;color:#111">
<div style="max-width:560px;margin:0 auto;padding:24px">
  <div style="background:#fff;border-radius:10px;overflow:hidden;border:1px solid #d8dbdf">
    <div style="background:#c8102e;color:#fff;padding:18px 24px;font-size:18px;font-weight:700">Berklee Mock Audition · EMN</div>
    <div style="padding:24px;line-height:1.55;font-size:15px">
      <p style="margin:0 0 14px">Hola ${nombre},</p>
      <p style="margin:0 0 14px">Tu slot del <strong>Berklee Mock Audition</strong> está confirmado:</p>
      <div style="background:#fce9eb;border-radius:8px;padding:14px 16px;margin:0 0 18px">
        <div style="font-size:17px;font-weight:700;text-transform:capitalize">${esc(fecha)}</div>
        <div style="font-size:17px;margin-top:2px">${inicio} – ${fin} <span style="color:#4b5563;font-size:14px">(hora de Perú)</span></div>
      </div>
      <p style="margin:0 0 18px"><a href="${safeLink}" style="display:inline-block;background:#c8102e;color:#fff;text-decoration:none;font-weight:700;padding:12px 24px;border-radius:6px">Entrar a la llamada</a></p>
      <p style="margin:0 0 6px"><strong>Importante:</strong></p>
      <ul style="margin:0 0 14px;padding-left:20px">
        <li>Conéctate unos minutos antes de tu hora.</li>
        <li>Sé puntual: pasada la hora de tu slot (${fin}, hora de Perú) <strong>no podremos evaluarte</strong>.</li>
        <li>Ten tu instrumento afinado, tu partitura y tu backing track listos, y prueba cámara y audio antes de entrar.</li>
      </ul>
      <p style="margin:0 0 14px">Encuentra cómo prepararte, qué tener listo y las preguntas frecuentes en <a href="https://emnlatam.github.io/mock-audition" style="color:#c8102e">emnlatam.github.io/mock-audition</a> (con tu cuenta).</p>
      <p style="margin:0">¡Nos vemos ahí!<br>Equipo EMN</p>
    </div>
  </div>
</div></body></html>`;
  const text = `Hola ${al.nombre.split(' ')[0]},\n\nTu slot del Berklee Mock Audition está confirmado:\n${fecha}, ${inicio} – ${fin} (hora de Perú)\n\nLlamada: ${link}\n\nImportante: conéctate unos minutos antes. Pasada la hora de tu slot (${fin}, hora de Perú) no podremos evaluarte.\n\nCómo prepararte: https://emnlatam.github.io/mock-audition\n\nEquipo EMN`;

  const payload: Record<string, unknown> = {
    from, to: [al.correo], subject: `Tu slot del Berklee Mock Audition: ${DIAS[dow]} ${d}/${mo}, ${inicio} (hora de Perú)`, html, text,
  };
  const reply = Deno.env.get('MAIL_REPLY_TO');
  if (reply) payload.reply_to = reply;

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!r.ok) return json({ ok: false, error: `Resend ${r.status}: ${(await r.text()).slice(0, 300)}` });

  await admin.from('mock_slots').update({ correo_enviado: true }).eq('id', slot.id);
  return json({ ok: true });
});
