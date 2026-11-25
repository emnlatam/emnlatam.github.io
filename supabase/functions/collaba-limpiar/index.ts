// Collaba: borra los archivos de las salas ya cerradas (clase + 12 h). La clase no existe -> también se borra.
// Idempotente y sin parámetros: solo toca salas vencidas, así que no necesita sesión (la llama pg_cron cada hora).
// Storage no permite borrar archivos con SQL, por eso se hace aquí con la service role.
// Deploy: supabase functions deploy collaba-limpiar --no-verify-jwt --project-ref gpoddvcrsdkpgfmyniqu
import { createClient } from 'npm:@supabase/supabase-js@2';

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
const DOCE_H = 12 * 3600 * 1000;

Deno.serve(async () => {
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const bucket = sb.storage.from('collaba');
  const { data: dirs, error } = await bucket.list('', { limit: 1000 });
  if (error) return json({ ok: false, error: error.message }, 500);
  const ids = (dirs ?? []).map((d) => d.name).filter((n) => /^[0-9a-f-]{36}$/i.test(n));
  if (!ids.length) return json({ ok: true, salas: 0, borradas: 0 });

  const { data: clases, error: e2 } = await sb.from('clases').select('id,fecha,hora').in('id', ids);
  if (e2) return json({ ok: false, error: e2.message }, 500);
  const porId = new Map((clases ?? []).map((c) => [c.id, c]));
  const ahora = Date.now();
  let borradas = 0, cerradas = 0;
  for (const id of ids) {
    const c = porId.get(id);
    let cerrada = !c;
    if (c) {
      let h = String(c.hora); h = h.length === 5 ? h + ':00' : h.slice(0, 8);
      const ini = Date.parse(`${c.fecha}T${h}-05:00`); // hora de Lima (UTC-5, sin horario de verano)
      cerrada = Number.isFinite(ini) && ahora > ini + DOCE_H;
    }
    if (!cerrada) continue;
    cerradas++;
    const { data: files } = await bucket.list(id, { limit: 100 });
    const paths = (files ?? []).map((f) => `${id}/${f.name}`);
    if (paths.length) {
      const { error: e3 } = await bucket.remove(paths);
      if (!e3) borradas += paths.length;
    }
  }
  return json({ ok: true, salas: ids.length, cerradas, borradas });
});
