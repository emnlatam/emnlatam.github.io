-- Mi Aula (/mi-aula): resumen del alumno para su dashboard.
-- Los alumnos no pueden leer alumnos/clases/cursos_meet (RLS solo staff), así que este RPC
-- (security definer) devuelve solo SUS datos. El staff puede pasar p_student para ver a otro alumno.
-- La ficha se liga por alumnos.student_id o, si no está ligada, por correo.
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
              'instrumento', v_al.datos->>'instrumento', 'pais', v_al.datos->>'pais', 'cursos', v_al.cursos),
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
