-- SingSync (antes Collaba; los objetos de base de datos conservan el prefijo collaba_): acceso a la sala privada de cada clase.
-- Requiere mi-aula.sql (profesores.correo) y alumnos.sql (clases, alumnos, profes_curso).
--
-- Reglas:
--   * La sala ES una clase (clases.id). Solo entran el alumno de esa clase y el profesor
--     asignado a ese curso (alumnos.profes_curso). Nadie más, tampoco el admin.
--   * Ventana: 12 h antes y 12 h después de la hora de la clase (24 h en total).
--     clases.hora está en hora de Lima (UTC-5, sin horario de verano), igual que en Mi Aula.
--   * El alumno se reconoce por alumnos.student_id o, si no está ligado, por correo.
--     El profesor, por el correo de su cuenta = profesores.correo (mismo criterio que mi_aula_mis_alumnos).
--   * Si algo no cuadra, responde ok=false (nunca deja pasar por error). Un extraño y una clase
--     inexistente reciben la misma respuesta 'no_autorizado', para que nadie pueda sondear ids.

create or replace function public.collaba_acceso(p_clase uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  em text;
  v_cl public.clases;
  v_al public.alumnos;
  v_prof text;
  v_rol text;
  v_ini timestamptz;
begin
  if uid is null then return jsonb_build_object('ok', false, 'motivo', 'sin_sesion'); end if;

  select * into v_cl from public.clases where id = p_clase;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'no_autorizado'); end if;
  select * into v_al from public.alumnos where id = v_cl.alumno_id;
  select email into em from public.students where id = uid;

  -- Los nombres de Airtable traen ":" al final.
  v_prof := nullif(btrim(rtrim(btrim(coalesce(v_al.profes_curso ->> v_cl.curso, '')), ':')), '');

  if v_al.student_id = uid
     or (em is not null and nullif(btrim(v_al.correo), '') is not null
         and lower(btrim(v_al.correo)) = lower(btrim(em))) then
    v_rol := 'alumno';
  elsif v_prof is not null and em is not null and exists (
      select 1 from public.profesores p
       where lower(btrim(p.correo)) = lower(btrim(em))
         and lower(btrim(rtrim(btrim(p.nombre), ':'))) = lower(v_prof)) then
    v_rol := 'profesor';
  end if;

  if v_rol is null then return jsonb_build_object('ok', false, 'motivo', 'no_autorizado'); end if;

  v_ini := (v_cl.fecha + v_cl.hora) at time zone 'America/Lima';

  if now() < v_ini - interval '12 hours' then
    return jsonb_build_object('ok', false, 'motivo', 'aun_no', 'desde', v_ini - interval '12 hours', 'curso', v_cl.curso);
  end if;
  if now() > v_ini + interval '12 hours' then
    return jsonb_build_object('ok', false, 'motivo', 'cerrada', 'hasta', v_ini + interval '12 hours', 'curso', v_cl.curso);
  end if;

  return jsonb_build_object(
    'ok', true, 'rol', v_rol, 'curso', v_cl.curso,
    'alumno', v_al.nombre, 'profesor', coalesce(v_prof, ''),
    'inicio', v_ini, 'desde', v_ini - interval '12 hours', 'hasta', v_ini + interval '12 hours');
end;
$$;
revoke all on function public.collaba_acceso(uuid) from public, anon;
grant execute on function public.collaba_acceso(uuid) to authenticated;

-- Revisión para el staff: clases de los próximos días cuya sala NO podría abrirse, y por qué.
-- Úsala antes de lanzar y de vez en cuando:  select * from public.collaba_diagnostico(14);
-- Fuera del staff devuelve vacío.
create or replace function public.collaba_diagnostico(p_dias int default 14)
returns table(clase_id uuid, fecha date, hora time, curso text, alumno text, problema text)
language sql
stable
security definer
set search_path = public
as $$
  select x.id, x.fecha, x.hora, x.curso, x.nombre, x.problema
  from (
    select c.id, c.fecha, c.hora, c.curso, a.nombre,
      case
        when a.student_id is null and not exists (
               select 1 from public.students s
                where nullif(btrim(a.correo), '') is not null and lower(btrim(s.email)) = lower(btrim(a.correo)))
          then 'El alumno no tiene cuenta enlazada'
        when nullif(btrim(coalesce(a.profes_curso ->> c.curso, '')), '') is null
          then 'La clase no tiene profesor asignado'
        when not exists (
               select 1 from public.profesores p
                where nullif(btrim(p.correo), '') is not null
                  and lower(btrim(rtrim(btrim(p.nombre), ':'))) = lower(btrim(rtrim(btrim(a.profes_curso ->> c.curso), ':')))
                  and exists (select 1 from public.students s where lower(btrim(s.email)) = lower(btrim(p.correo))))
          then 'El profesor no tiene cuenta enlazada (revisa su correo en Profesores)'
      end as problema
    from public.clases c
    join public.alumnos a on a.id = c.alumno_id
    where c.fecha between current_date and current_date + p_dias
  ) x
  where x.problema is not null and public.emn_is_staff()
  order by x.fecha, x.hora;
$$;
revoke all on function public.collaba_diagnostico(int) from public, anon;
grant execute on function public.collaba_diagnostico(int) to authenticated;
