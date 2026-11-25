-- Mi Aula (/mi-aula): resumen del alumno para su dashboard.
-- Los alumnos no pueden leer alumnos/clases/cursos_meet (RLS solo staff), así que este RPC
-- (security definer) devuelve solo SUS datos. El staff puede pasar p_student para ver a otro alumno.
-- La ficha se liga por alumnos.student_id o, si no está ligada, por correo.
-- Alumnos (con cuenta) de un profesor: los que lo tienen asignado en algún curso (alumnos.profes_curso).
-- El profesor se reconoce por el correo de su cuenta = profesores.correo. Los nombres de Airtable traen ":" al final.
create or replace function public.mi_aula_mis_alumnos()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  em text;
  pn text;
begin
  if uid is null then raise exception 'No autenticado'; end if;
  select email into em from public.students where id = uid;
  select lower(btrim(rtrim(btrim(nombre), ':'))) into pn from public.profesores
   where em is not null and lower(btrim(correo)) = lower(btrim(em)) limit 1;
  if pn is null then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', a.student_id, 'nombre', a.nombre) order by a.nombre)
    from public.alumnos a
    where a.student_id is not null and a.activo
      and exists (select 1 from jsonb_each_text(a.profes_curso) j
                   where lower(btrim(rtrim(btrim(j.value), ':'))) = pn)
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.mi_aula_mis_alumnos() from public, anon;
grant execute on function public.mi_aula_mis_alumnos() to authenticated;

-- mi_aula_resumen: un profesor (no admin) solo puede ver a SUS alumnos.
create or replace function public.mi_aula_resumen(p_student uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  tgt uuid;
  em text;
  v_al public.alumnos;
begin
  if uid is null then raise exception 'No autenticado'; end if;
  tgt := uid;
  if p_student is not null and p_student <> uid then
    if not public.emn_is_staff() then raise exception 'Sin permiso'; end if;
    if not exists (select 1 from public.students where id = uid and role = 'admin')
       and not exists (select 1 from jsonb_array_elements(public.mi_aula_mis_alumnos()) x where (x->>'id')::uuid = p_student) then
      raise exception 'Sin permiso';
    end if;
    tgt := p_student;
  end if;

  select email into em from public.students where id = tgt;
  select * into v_al from public.alumnos
   where student_id = tgt or (em is not null and lower(btrim(correo)) = lower(btrim(em)))
   order by (student_id = tgt) desc nulls last
   limit 1;
  if not found then return jsonb_build_object('alumno', null); end if;

  return jsonb_build_object(
    'alumno', jsonb_build_object('id', v_al.id, 'nombre', v_al.nombre,
              'instrumento', v_al.datos->>'instrumento', 'pais', v_al.datos->>'pais', 'cursos', v_al.cursos,
              -- tareas de alumnos.datos._tareas ({id,curso,texto,hecha,hecha_por}); la página decide cuáles muestra
              'tareas', coalesce(v_al.datos->'_tareas', '[]'::jsonb)),
    'clases', coalesce((
      select jsonb_agg(jsonb_build_object('curso', c.curso, 'fecha', c.fecha, 'hora', to_char(c.hora, 'HH24:MI'),
               'link', coalesce(nullif(c.link, ''), (select m.link from public.cursos_meet m where m.curso = c.curso)))
             order by c.fecha, c.hora)
      from public.clases c where c.alumno_id = v_al.id), '[]'::jsonb),
    'mock', coalesce((
      select jsonb_agg(jsonb_build_object('fecha', s.fecha, 'hora', s.hora,
               'link', coalesce(nullif((select f.link from public.mock_fechas f where f.fecha = s.fecha), ''),
                                (select m.link from public.cursos_meet m where m.curso = 'Mock Audition')))
             order by s.fecha)
      from public.mock_slots s where s.alumno_id = v_al.id and s.fecha >= current_date - 60), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.mi_aula_resumen(uuid) from public, anon;
grant execute on function public.mi_aula_resumen(uuid) to authenticated;

-- Ligar las cuentas de los alumnos vigentes a su ficha (Albert y Santiago).
update public.alumnos set student_id = 'c50b70ac-e10c-45ed-9f1b-228a5d513be6'
 where id = '4e699ec0-e324-4a89-b83b-2785faf2a59e' and student_id is null;
update public.alumnos set student_id = '58ae5ce5-3cc3-493b-81ac-436ca5a5f1e0'
 where id = 'ca13caaf-3b4f-49fe-80b0-69ef010d925b' and student_id is null;

-- El alumno marca una de SUS tareas como hecha (los alumnos no pueden escribir en `alumnos`, por eso es un RPC).
-- Devuelve la lista de tareas actualizada. La tarea queda guardada con hecha_por = 'alumno' para que el profesor la vea opaca.
create or replace function public.mi_aula_tarea_hecha(p_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  em text;
  v_al public.alumnos;
  nuevas jsonb;
begin
  if uid is null then raise exception 'No autenticado'; end if;
  select email into em from public.students where id = uid;
  select * into v_al from public.alumnos
   where student_id = uid or (em is not null and lower(btrim(correo)) = lower(btrim(em)))
   order by (student_id = uid) desc nulls last
   limit 1;
  if not found then raise exception 'Sin ficha de alumno'; end if;
  select coalesce(jsonb_agg(case when t->>'id' = p_id
                                 then t || jsonb_build_object('hecha', true, 'hecha_por', 'alumno', 'hecha_el', now())
                                 else t end order by ord), '[]'::jsonb)
    into nuevas
    from jsonb_array_elements(coalesce(v_al.datos->'_tareas', '[]'::jsonb)) with ordinality as x(t, ord);
  update public.alumnos set datos = jsonb_set(coalesce(datos, '{}'::jsonb), '{_tareas}', nuevas) where id = v_al.id;
  return nuevas;
end;
$$;
revoke all on function public.mi_aula_tarea_hecha(text) from public, anon;
grant execute on function public.mi_aula_tarea_hecha(text) to authenticated;
