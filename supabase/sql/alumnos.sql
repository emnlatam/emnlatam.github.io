-- Alumnos + Calendario de clases (/alumnos, /calendario).
-- Tablas con datos personales -> RLS activado, solo admin/profesor
-- (public.emn_is_staff(), definida en cursos.sql).

create table if not exists public.alumnos (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  nombre text not null check (char_length(btrim(nombre)) between 2 and 120),
  correo text,
  whatsapp text,
  datos jsonb not null default '{}'::jsonb,       -- el resto de campos de "Students Info" (ver _data/alumnos_campos.yml)
  cursos text[] not null default '{}',            -- cursos asignados (el Mock Audition es automático y no se guarda)
  color text not null default '#3358C4',          -- color del alumno en el calendario
  student_id uuid references public.students(id) on delete set null,  -- cuenta de la app, si ya la tiene
  airtable_id text unique                          -- id del registro en Airtable (Students Info)
);

create table if not exists public.clases (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  alumno_id uuid not null references public.alumnos(id) on delete cascade,
  curso text not null,
  fecha date not null,
  hora time not null default '18:00',
  link text
);
create index if not exists clases_fecha_idx on public.clases (fecha);

-- Un link de Meet por curso (se copia a cada clase nueva, y se puede cambiar clase por clase).
create table if not exists public.cursos_meet (
  curso text primary key,
  link text
);

alter table public.alumnos enable row level security;
alter table public.clases enable row level security;
alter table public.cursos_meet enable row level security;

create policy "alumnos_staff" on public.alumnos for all to authenticated
  using (public.emn_is_staff()) with check (public.emn_is_staff());
create policy "clases_staff" on public.clases for all to authenticated
  using (public.emn_is_staff()) with check (public.emn_is_staff());
create policy "cursos_meet_staff" on public.cursos_meet for all to authenticated
  using (public.emn_is_staff()) with check (public.emn_is_staff());

-- Profesores (tabla "Professors info" de Airtable) — pestaña Profesores de /alumnos.
create table if not exists public.profesores (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  nombre text not null check (char_length(btrim(nombre)) between 2 and 120),
  especializacion text,
  tipo text,
  pais text,
  calendly text,
  celular text,
  airtable_id text unique
);
alter table public.profesores enable row level security;
create policy "profesores_staff" on public.profesores for all to authenticated
  using (public.emn_is_staff()) with check (public.emn_is_staff());

-- Profesor asignado a cada curso del alumno: { "Piece Preparation": "Nombre del profesor", ... }
alter table public.alumnos add column if not exists profes_curso jsonb not null default '{}'::jsonb;

-- Clases por mes de cada curso del alumno: { "Piece Preparation": 4, ... } (1 a 8)
alter table public.alumnos add column if not exists clases_mes jsonb not null default '{}'::jsonb;

-- Invoices + Finanzas (/invoices). Una fila por pago: si el programa se divide en 2 pagos
-- hay 2 filas con el mismo "grupo". "datos" guarda todo lo necesario para volver a generar el PDF.
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,          -- número de invoice (EMN-0001, ...)
  grupo uuid not null,
  created_at timestamptz not null default now(),
  alumno_id uuid references public.alumnos(id) on delete set null,
  alumno_nombre text not null,
  programa text not null,                           -- resumen del programa completo (para Finanzas)
  pago int not null default 1 check (pago in (1, 2)),
  pagos int not null default 1 check (pagos in (1, 2)),
  monto numeric(12,2) not null check (monto >= 0),
  moneda text not null default 'USD',
  vence date,
  link text,                                        -- link de pago de Stripe
  estado text not null default 'pendiente' check (estado in ('pendiente', 'pagado')),
  pagado_el date,                                   -- fecha en que entró el dinero
  datos jsonb not null default '{}'::jsonb
);
alter table public.invoices enable row level security;
create policy "invoices_staff" on public.invoices for all to authenticated
  using (public.emn_is_staff()) with check (public.emn_is_staff());
