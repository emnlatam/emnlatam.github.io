-- Berklee Mock Audition (/mock-audition): el último domingo de cada mes, 4 slots de 1 hora
-- (11–12, 12–1, 1–2 y 2–3 hora Perú). Admin/profesor agendan; los alumnos con cuenta ven los slots
-- y los nombres del mes siguiente. Escritura solo staff (public.emn_is_staff(), definida en cursos.sql).

-- Link de la llamada de cada fecha (solo staff: a los alumnos les llega por correo).
create table if not exists public.mock_fechas (
  fecha date primary key,
  link text
);

create table if not exists public.mock_slots (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  fecha date not null,
  hora smallint not null check (hora between 11 and 14),               -- hora de inicio, hora Perú
  alumno_id uuid not null references public.alumnos(id) on delete cascade,
  nombre text not null,                                                -- copia del nombre: los alumnos ven los slots sin acceder a la ficha (ni al correo)
  student_id uuid references public.students(id) on delete set null,   -- cuenta de la app del alumno, para resaltar "su" slot
  correo_enviado boolean not null default false,
  unique (fecha, hora),
  unique (fecha, alumno_id)
);
create index if not exists mock_slots_fecha_idx on public.mock_slots (fecha);

alter table public.mock_fechas enable row level security;
alter table public.mock_slots enable row level security;

drop policy if exists "mock_fechas_staff" on public.mock_fechas;
create policy "mock_fechas_staff" on public.mock_fechas for all to authenticated
  using (public.emn_is_staff()) with check (public.emn_is_staff());
drop policy if exists "mock_slots_staff" on public.mock_slots;
create policy "mock_slots_staff" on public.mock_slots for all to authenticated
  using (public.emn_is_staff()) with check (public.emn_is_staff());
-- Cualquier persona con cuenta puede ver los slots (solo nombres, nada de correos).
drop policy if exists "mock_slots_ver" on public.mock_slots;
create policy "mock_slots_ver" on public.mock_slots for select to authenticated using (true);

-- ---------------------------------------------------------------------------------------------
-- Reserva por el propio alumno. Los alumnos no escriben en mock_slots: pasan por estas funciones,
-- que solo dejan reservar un slot LIBRE de la sesión del MES SIGUIENTE (hora de Lima).
-- La cuenta se liga a su ficha de `alumnos` por student_id o, si no está ligada, por correo.
-- ---------------------------------------------------------------------------------------------
create or replace function public.mock_reservar(p_fecha date, p_hora smallint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  hoy date := (now() at time zone 'America/Lima')::date;
  fin_sig date;
  dom_sig date;
  v_al public.alumnos;
  v_mail text;
  v_id uuid;
begin
  if uid is null then raise exception 'Inicia sesión para reservar.'; end if;

  fin_sig := (date_trunc('month', hoy::timestamp) + interval '2 months' - interval '1 day')::date;
  dom_sig := fin_sig - extract(dow from fin_sig)::int;
  if p_fecha is distinct from dom_sig then raise exception 'Solo puedes reservar la sesión del mes siguiente.'; end if;
  if p_hora is null or p_hora not between 11 and 14 then raise exception 'Ese horario no es válido.'; end if;

  select * into v_al from public.alumnos where student_id = uid limit 1;
  if v_al.id is null then
    select email into v_mail from auth.users where id = uid;
    select * into v_al from public.alumnos where v_mail is not null and lower(btrim(correo)) = lower(btrim(v_mail)) limit 1;
    if v_al.id is not null then update public.alumnos set student_id = uid where id = v_al.id; end if;
  end if;
  if v_al.id is null then
    raise exception 'Tu cuenta todavía no está vinculada a tu ficha de alumno. Escríbenos a admisiones@emnperu.com.';
  end if;
  if v_al.activo is false then raise exception 'Tu ficha de alumno no está activa. Escríbenos a admisiones@emnperu.com.'; end if;

  if exists (select 1 from public.mock_slots where fecha = p_fecha and alumno_id = v_al.id) then
    raise exception 'Ya tienes un horario reservado para esa fecha. Cancélalo si quieres elegir otro.';
  end if;

  begin
    insert into public.mock_slots (fecha, hora, alumno_id, nombre, student_id)
    values (p_fecha, p_hora, v_al.id, v_al.nombre, uid)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Ese horario ya fue tomado. Elige otro.';
  end;

  return jsonb_build_object('id', v_id);
end;
$$;

-- Cancelar la propia reserva (para liberar el slot o elegir otro). Solo fechas futuras.
create or replace function public.mock_cancelar(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare hoy date := (now() at time zone 'America/Lima')::date;
begin
  delete from public.mock_slots where id = p_id and student_id = auth.uid() and fecha > hoy;
  if not found then raise exception 'No encontré esa reserva.'; end if;
end;
$$;

revoke all on function public.mock_reservar(date, smallint) from public, anon;
revoke all on function public.mock_cancelar(uuid) from public, anon;
grant execute on function public.mock_reservar(date, smallint) to authenticated;
grant execute on function public.mock_cancelar(uuid) to authenticated;
