-- Postulaciones — formulario corto del botón "Postula" del inicio (/emn/).
-- Ya está aplicado en Supabase (proyecto gpoddvcrsdkpgfmyniqu); este archivo es
-- el registro, por si hay que recrear la tabla.
--
-- A diferencia del resto de la app (RLS desactivado), aquí SÍ se usa RLS: la
-- tabla guarda nombre, correo y WhatsApp de personas. Cualquiera puede ENVIAR
-- una postulación sin iniciar sesión, pero nadie con la anon key puede LEERLAS:
-- solo admin/profesor (función public.emn_is_staff(), de cursos.sql).

create table if not exists public.postulaciones (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  nombre text not null check (char_length(btrim(nombre)) between 2 and 120),
  correo text not null check (char_length(btrim(correo)) between 5 and 200),
  whatsapp text not null check (char_length(btrim(whatsapp)) between 6 and 40),
  video text not null check (char_length(btrim(video)) between 3 and 500),  -- link a un video tocando
  estado text not null default 'nuevo' check (estado in ('nuevo', 'contactado', 'descartado'))
);

alter table public.postulaciones enable row level security;

create policy "postulaciones_enviar" on public.postulaciones
  for insert to anon, authenticated
  with check (estado = 'nuevo');

create policy "postulaciones_staff_leer" on public.postulaciones
  for select to authenticated using (public.emn_is_staff());

create policy "postulaciones_staff_editar" on public.postulaciones
  for update to authenticated using (public.emn_is_staff()) with check (public.emn_is_staff());

create policy "postulaciones_staff_borrar" on public.postulaciones
  for delete to authenticated using (public.emn_is_staff());
