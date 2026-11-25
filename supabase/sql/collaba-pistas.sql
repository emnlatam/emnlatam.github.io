-- SingSync etapa 2 (antes Collaba; los objetos conservan el prefijo collaba_): pistas de audio en la nube + canal de tiempo real de la sala.
-- Requiere collaba.sql (collaba_acceso).
--
-- Reglas:
--   * Bucket privado "collaba". Cada archivo vive en  <clase_id>/<archivo>.
--   * Solo entran a ese "directorio" el alumno de la clase y su profesor, dentro de la ventana de 12 h
--     (la misma regla de collaba_acceso). Nadie más, tampoco el admin.
--   * Máximo 5 pistas por clase, 25 MB cada una, solo audio (lo exige el propio bucket).
--   * Subir y leer: alumno y profesor. Borrar: quien la subió, o el profesor.
--   * Al cerrarse la sala, la Edge Function collaba-limpiar borra los archivos (ver abajo).
--   * Tiempo real: canal PRIVADO "collaba:<clase_id>"; solo quien pasa collaba_acceso puede leer o enviar.

create or replace function public.collaba_puede(p_clase uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((public.collaba_acceso(p_clase) ->> 'ok')::boolean, false);
$$;

create or replace function public.collaba_rol(p_clase uuid)
returns text language sql stable security definer set search_path = public as $$
  select public.collaba_acceso(p_clase) ->> 'rol';
$$;

-- "<uuid>/archivo" -> uuid, o null si el nombre no tiene esa forma (nunca lanza error).
create or replace function public.collaba_clase_de_path(p_name text)
returns uuid language plpgsql immutable set search_path = public as $$
begin
  return split_part(p_name, '/', 1)::uuid;
exception when others then
  return null;
end;
$$;

-- "collaba:<uuid>" -> ¿esta cuenta puede entrar a ese canal ahora? (false ante cualquier duda)
create or replace function public.collaba_topic_ok(p_topic text)
returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  if p_topic is null or p_topic not like 'collaba:%' then return false; end if;
  return public.collaba_puede(substr(p_topic, 9)::uuid);
exception when others then
  return false;
end;
$$;

revoke all on function public.collaba_puede(uuid), public.collaba_rol(uuid), public.collaba_clase_de_path(text), public.collaba_topic_ok(text) from public, anon;
grant execute on function public.collaba_puede(uuid), public.collaba_rol(uuid), public.collaba_clase_de_path(text), public.collaba_topic_ok(text) to authenticated;

-- Bucket privado: 25 MB por archivo, solo audio.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('collaba', 'collaba', false, 26214400, array['audio/*'])
on conflict (id) do update set public = false, file_size_limit = 26214400, allowed_mime_types = array['audio/*'];

drop policy if exists "collaba_pistas_leer" on storage.objects;
create policy "collaba_pistas_leer" on storage.objects for select to authenticated
  using (bucket_id = 'collaba' and public.collaba_puede(public.collaba_clase_de_path(name)));

drop policy if exists "collaba_pistas_subir" on storage.objects;
create policy "collaba_pistas_subir" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'collaba'
    and name ~ '^[0-9a-f-]{36}/[^/]+$'
    and public.collaba_puede(public.collaba_clase_de_path(name))
    and (select count(*) from storage.objects o
          where o.bucket_id = 'collaba' and split_part(o.name, '/', 1) = split_part(objects.name, '/', 1)) < 5
  );

drop policy if exists "collaba_pistas_borrar" on storage.objects;
create policy "collaba_pistas_borrar" on storage.objects for delete to authenticated
  using (
    bucket_id = 'collaba'
    and public.collaba_puede(public.collaba_clase_de_path(name))
    and (owner = auth.uid() or owner_id = auth.uid()::text
         or public.collaba_rol(public.collaba_clase_de_path(name)) = 'profesor')
  );

-- Tiempo real: canal privado por clase.
drop policy if exists "collaba_rt_leer" on realtime.messages;
create policy "collaba_rt_leer" on realtime.messages for select to authenticated
  using (realtime.messages.extension in ('broadcast', 'presence') and public.collaba_topic_ok((select realtime.topic())));

drop policy if exists "collaba_rt_enviar" on realtime.messages;
create policy "collaba_rt_enviar" on realtime.messages for insert to authenticated
  with check (realtime.messages.extension in ('broadcast', 'presence') and public.collaba_topic_ok((select realtime.topic())));

-- Limpieza: la Edge Function collaba-limpiar (supabase/functions/collaba-limpiar) borra los archivos de las salas
-- ya cerradas (clase + 12 h). Storage no permite borrar archivos con SQL, por eso es una función aparte.
-- Se ejecuta cada hora con pg_cron + pg_net.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;
select cron.unschedule('collaba-limpiar') where exists (select 1 from cron.job where jobname = 'collaba-limpiar');
select cron.schedule('collaba-limpiar', '7 * * * *', $cron$
  select net.http_post(url := 'https://gpoddvcrsdkpgfmyniqu.supabase.co/functions/v1/collaba-limpiar',
                       headers := '{"Content-Type":"application/json"}'::jsonb, body := '{}'::jsonb);
$cron$);
