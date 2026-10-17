-- Alertas para el tablero visual de EMN (nuevas postulaciones, etc.).
-- Escrito el 2026-10-14. NO aplicado todavía: ejecutar en el SQL Editor del
-- proyecto gpoddvcrsdkpgfmyniqu cuando se quiera activar.
--
-- Solo la función respuesta-postulante escribe (con service role). El staff
-- (admin/profesor) puede leer y marcar como vista. RLS activado porque guarda
-- nombre y correo de personas.

create table if not exists public.alertas (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  tipo text not null,                  -- p. ej. 'nueva_postulacion'
  origen text,                         -- 'formulario-pregrado' | 'web'
  nombre text,
  correo text,
  correo_enviado boolean not null default false,
  detalle text,                        -- error de envío, si lo hubo
  vista boolean not null default false
);

alter table public.alertas enable row level security;

create policy "alertas_staff_leer" on public.alertas
  for select to authenticated using (public.emn_is_staff());

create policy "alertas_staff_marcar" on public.alertas
  for update to authenticated using (public.emn_is_staff()) with check (public.emn_is_staff());
