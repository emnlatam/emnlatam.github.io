-- Racha en días con semanas off (Mi Aula, 2026-11-25).
-- Cada semana (lunes a domingo) con >= 5 h cuenta +7 días. Cada 4 semanas cumplidas se gana 1 semana off.
-- Esta tabla guarda la decisión del alumno sobre una semana que no llegó a la meta:
--   usada = true  -> gastó una semana off (la racha se protege)
--   usada = false -> decidió no usarla (la racha vuelve a 0)
-- El cálculo (días, ciclo, semanas off disponibles) se hace en la página repitiendo el historial;
-- las filas inválidas (sin semanas off, más de 2 seguidas) simplemente se ignoran.
create table if not exists public.practice_off_weeks (
  student_id uuid not null references public.students(id) on delete cascade,
  week_start date not null,
  usada boolean not null,
  created_at timestamptz not null default now(),
  primary key (student_id, week_start)
);
alter table public.practice_off_weeks enable row level security;
create policy "practice_off_weeks_ver" on public.practice_off_weeks
  for select to authenticated using (student_id = auth.uid() or public.emn_is_staff());
create policy "practice_off_weeks_insertar" on public.practice_off_weeks
  for insert to authenticated with check (student_id = auth.uid() or public.emn_is_staff());
