-- Límite de intentos de "¿Olvidaste tu contraseña?" (Edge Function password-reset).
-- Cada intento fallido (correo no registrado) o envío de link queda registrado con la IP de quien lo hizo;
-- con 4 en la última hora, esa IP queda bloqueada hasta que el más antiguo cumpla una hora.
-- Solo lo lee/escribe la función (service role): RLS activado y sin políticas = nadie más puede verla.
create table if not exists public.password_reset_intentos (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  ip text not null,
  motivo text not null check (motivo in ('denegado', 'envio'))
);
create index if not exists password_reset_intentos_ip_idx on public.password_reset_intentos (ip, created_at);
alter table public.password_reset_intentos enable row level security;
