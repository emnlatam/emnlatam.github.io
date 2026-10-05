// EMN — airtable-sync Edge Function
//
// Puente entre /alumnos y la tabla "Students Info" de Airtable. El token de
// Airtable nunca debe llegar al navegador, por eso vive aquí como secret.
// Solo admin y profesor pueden llamarla.
//
// Secrets necesarios (una sola vez):
//   supabase secrets set AIRTABLE_TOKEN=pat... AIRTABLE_BASE_ID=app... AIRTABLE_TABLE="Students Info" AIRTABLE_TABLE_PROFESSORS="Professors info" --project-ref gpoddvcrsdkpgfmyniqu
// El token (Personal Access Token) necesita los permisos data.records:read y
// data.records:write sobre esa base.
//
// Deploy:  supabase functions deploy airtable-sync --project-ref gpoddvcrsdkpgfmyniqu
//
// Todas las acciones aceptan table: 'profesores' (tabla de profesores); sin eso usan la de alumnos.
// Acciones (POST JSON):
//   { action: 'list', textFields?: ['Col'] }            -> { records: [{ id, fields, text }] } (todas, con paginación;
//        text[col] = el valor de esas columnas como TEXTO — así los campos vinculados llegan con nombres y no con ids rec…)
//   { action: 'upsert', id?: 'recXXXX', fields: {...} } -> { id }   (crea si no hay id, actualiza si hay)
//   { action: 'delete', id: 'recXXXX' }                 -> { ok: true }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

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
  const { data: row } = await admin.from('students').select('role').eq('id', user.id).maybeSingle();
  if (row?.role !== 'admin' && row?.role !== 'professor') return json({ error: 'Staff only' }, 403);

  const token = Deno.env.get('AIRTABLE_TOKEN');
  const base = Deno.env.get('AIRTABLE_BASE_ID');
  if (!token || !base) return json({ error: 'Airtable no está configurado (faltan los secrets AIRTABLE_TOKEN / AIRTABLE_BASE_ID).' }, 500);

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const fail = async (r: Response) => json({ error: `Airtable ${r.status}: ${(await r.text()).slice(0, 300)}` }, 502);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }

  const table = body.table === 'profesores'
    ? (Deno.env.get('AIRTABLE_TABLE_PROFESSORS') || 'Professors info')
    : (Deno.env.get('AIRTABLE_TABLE') || 'Students Info');
  const api = `https://api.airtable.com/v0/${base}/${encodeURIComponent(table)}`;

  if (body.action === 'list') {
    const textFields: string[] = Array.isArray(body.textFields) ? body.textFields.filter((x: unknown) => typeof x === 'string') : [];
    const fetchAll = async (extra: string) => {
      const out: any[] = [];
      let offset = '';
      do {
        const r = await fetch(`${api}?pageSize=100${extra}${offset ? `&offset=${offset}` : ''}`, { headers });
        if (!r.ok) return { fail: await fail(r) };
        const page = await r.json();
        out.push(...page.records);
        offset = page.offset || '';
      } while (offset);
      return { out };
    };
    const main = await fetchAll('');
    if (main.fail) return main.fail;
    const texts: Record<string, Record<string, string>> = {};
    if (textFields.length) {
      // Segunda lectura con cellFormat=string: los vinculados salen como el texto de su campo principal.
      const q = textFields.map((f) => `&fields%5B%5D=${encodeURIComponent(f)}`).join('') + '&cellFormat=string&timeZone=America%2FLima&userLocale=es';
      const t = await fetchAll(q);
      if (t.fail) return t.fail;
      for (const x of t.out!) texts[x.id] = x.fields;
    }
    return json({ records: main.out!.map((x: any) => ({ id: x.id, fields: x.fields, text: texts[x.id] || {} })) });
  }

  if (body.action === 'upsert') {
    if (!body.fields || typeof body.fields !== 'object') return json({ error: 'fields is required' }, 400);
    const r = body.id
      ? await fetch(`${api}/${body.id}`, { method: 'PATCH', headers, body: JSON.stringify({ fields: body.fields, typecast: true }) })
      : await fetch(api, { method: 'POST', headers, body: JSON.stringify({ fields: body.fields, typecast: true }) });
    if (!r.ok) return fail(r);
    const rec = await r.json();
    return json({ id: rec.id });
  }

  if (body.action === 'delete') {
    if (!body.id) return json({ error: 'id is required' }, 400);
    const r = await fetch(`${api}/${body.id}`, { method: 'DELETE', headers });
    if (!r.ok) return fail(r);
    return json({ ok: true });
  }

  return json({ error: 'Unknown action' }, 400);
});
