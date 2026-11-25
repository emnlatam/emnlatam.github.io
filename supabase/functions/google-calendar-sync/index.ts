// EMN — google-calendar-sync Edge Function
//
// Espejo en UNA dirección: lo que se agenda en /calendario se crea en Google Calendar de emnlatam@gmail.com.
//  - Un calendario por alumno ("EMN · Nombre"), guardado en alumnos.google_calendar_id.
//  - Cada clase = un evento (clases.google_event_id) con el alumno y el profesor como invitados.
//  - El link de Meet se crea con la API de Google Meet con accessType OPEN (entra cualquiera con el link,
//    sin que nadie lo admita) y se guarda en clases.link.
// Solo admin y profesor pueden llamarla.
//
// Secrets: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN (cuenta emnlatam@gmail.com;
// permisos calendar + meetings.space.created).
// Deploy:  supabase functions deploy google-calendar-sync --project-ref gpoddvcrsdkpgfmyniqu
//
// Acciones (POST JSON):
//   (quiet: true en cualquiera = sin correos de invitación)
//   { action: 'sync',   clase_id }  -> crea o actualiza el evento de esa clase  -> { ok, link, event_id }
//   { action: 'remove', clase_id }  -> borra el evento de Google (la fila de clases la borra la página) -> { ok }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const TZ = 'America/Lima';         // las clases se guardan en hora de Lima
const DURACION_MIN = 60;
const norm = (s: string) => String(s || '').trim().replace(/:+$/, '').trim().toLowerCase();

async function accessToken(): Promise<string> {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: Deno.env.get('GOOGLE_CLIENT_ID')!, client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!,
      refresh_token: Deno.env.get('GOOGLE_REFRESH_TOKEN')!, grant_type: 'refresh_token',
    }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('Google token: ' + JSON.stringify(j).slice(0, 200));
  return j.access_token;
}

async function g(token: string, url: string, method = 'GET', body?: unknown) {
  const r = await fetch(url, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 204) return {};
  const t = await r.text();
  let j: any = {}; try { j = JSON.parse(t); } catch { /* vacío */ }
  if (!r.ok) throw Object.assign(new Error(`Google ${r.status}: ${t.slice(0, 300)}`), { status: r.status });
  return j;
}

// "2026-12-01" + "18:00:00" + minutos -> "2026-12-01T19:00:00" (sin zona: va con timeZone aparte)
function addMin(fecha: string, hora: string, min: number) {
  const [y, m, d] = fecha.split('-').map(Number); const [hh, mm] = hora.split(':').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d, hh, mm + min));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}T${p(t.getUTCHours())}:${p(t.getUTCMinutes())}:00`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'Missing Authorization header' }, 401);
  const url = Deno.env.get('SUPABASE_URL')!;
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // Staff (admin/profesor) con sesión, o la service role (pruebas / tareas internas).
  if (authHeader.slice(7) !== Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) {
    const callerClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !user) return json({ error: 'Invalid session' }, 401);
    const { data: row } = await admin.from('students').select('role').eq('id', user.id).maybeSingle();
    if (row?.role !== 'admin' && row?.role !== 'professor') return json({ error: 'Staff only' }, 403);
  }

  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const { action, clase_id } = body || {};
  const quiet = body?.quiet === true;                 // quiet: crea/actualiza SIN mandar correos de invitación
  const SU = quiet ? 'none' : 'all';
  if (!clase_id) return json({ error: 'Falta clase_id' }, 400);

  try {
    const token = await accessToken();
    const { data: cl } = await admin.from('clases').select('*').eq('id', clase_id).maybeSingle();
    if (!cl) return json({ error: 'Clase no encontrada' }, 404);
    const { data: al } = await admin.from('alumnos').select('*').eq('id', cl.alumno_id).maybeSingle();
    if (!al) return json({ error: 'Alumno no encontrado' }, 404);

    // ---- Borrar ----
    if (action === 'remove') {
      if (cl.google_event_id && al.google_calendar_id) {
        try {
          await g(token, `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(al.google_calendar_id)}/events/${cl.google_event_id}?sendUpdates=${SU}`, 'DELETE');
        } catch (e) { if ((e as any).status !== 404 && (e as any).status !== 410) throw e; }
      }
      return json({ ok: true });
    }
    if (action !== 'sync') return json({ error: 'Acción desconocida' }, 400);

    // ---- Calendario del alumno (se crea la primera vez) ----
    let calId: string = al.google_calendar_id;
    if (!calId) {
      const c = await g(token, 'https://www.googleapis.com/calendar/v3/calendars', 'POST',
        { summary: `EMN · ${String(al.nombre).replace(/:+$/, '').trim()}`, timeZone: TZ });
      calId = c.id;
      await admin.from('alumnos').update({ google_calendar_id: calId }).eq('id', al.id);
    }

    // ---- Invitados: alumno + profesor del curso ----
    const emails: string[] = [];
    if (al.correo) emails.push(String(al.correo).trim());
    const profName = al.profes_curso?.[cl.curso];
    if (profName) {
      const { data: profs } = await admin.from('profesores').select('nombre,correo');
      const p = (profs || []).find((x: any) => norm(x.nombre) === norm(profName));
      if (p?.correo) emails.push(String(p.correo).trim());
    }
    const attendees = [...new Set(emails.map((e) => e.toLowerCase()))].map((email) => ({ email }));

    // ---- Meet abierto (solo al crear el evento; al actualizar se conserva) ----
    let link: string | null = cl.google_event_id ? cl.link : null, acceso: string | null = null;
    if (!link) {
      const sp = await g(token, 'https://meet.googleapis.com/v2/spaces', 'POST', { config: { accessType: 'OPEN' } });
      link = sp.meetingUri; acceso = sp.config?.accessType ?? null;
    }

    const hora = String(cl.hora).slice(0, 8);
    const nombre = String(al.nombre).replace(/:+$/, '').trim();
    const event = {
      summary: `${cl.curso} — ${nombre}`,
      location: link,
      description: `Clase de ${cl.curso} con ${nombre}.\nVideollamada (entra directo, sin esperar aprobación): ${link}`,
      start: { dateTime: addMin(cl.fecha, hora, 0), timeZone: TZ },
      end: { dateTime: addMin(cl.fecha, hora, DURACION_MIN), timeZone: TZ },
      attendees,
    };
    const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events`;
    let ev: any;
    if (cl.google_event_id) {
      try { ev = await g(token, `${base}/${cl.google_event_id}?sendUpdates=${SU}`, 'PATCH', event); }
      catch (e) { if ((e as any).status !== 404) throw e; }
    }
    if (!ev) ev = await g(token, `${base}?sendUpdates=${SU}`, 'POST', event);

    await admin.from('clases').update({ google_event_id: ev.id, link }).eq('id', cl.id);
    return json({ ok: true, link, event_id: ev.id, acceso_meet: acceso, invitados: attendees.map((a) => a.email) });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 502);
  }
});
