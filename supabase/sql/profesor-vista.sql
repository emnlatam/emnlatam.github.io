-- Vista del profesor en Mi Aula (2026-11-28)
-- 1) Link de Drive por profesor (lo asigna el admin en Comunidad -> editar profesor). Solo vive en Supabase, no va a Airtable.
alter table public.profesores add column if not exists drive_link text;

-- 2) Entrar al perfil del alumno cuenta como revisar sus tareas: las que el alumno marco como hechas pasan a "revisada".
--    "Tareas por revisar" = hecha por el alumno y aun no revisada.
create or replace function public.mi_aula_tareas_revisadas(p_student uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'No autenticado'; end if;
  if not public.emn_is_staff() then raise exception 'Sin permiso'; end if;
  if not exists (select 1 from public.students where id = uid and role = 'admin')
     and not exists (select 1 from jsonb_array_elements(public.mi_aula_mis_alumnos()) x where (x->>'id')::uuid = p_student) then
    raise exception 'Sin permiso';
  end if;
  update public.alumnos a
     set datos = jsonb_set(a.datos, '{_tareas}', (
       select coalesce(jsonb_agg(
         case when t->>'hecha' = 'true' and coalesce(t->>'hecha_por', '') = 'alumno' and coalesce(t->>'revisada', '') <> 'true'
              then t || '{"revisada": true}'::jsonb else t end), '[]'::jsonb)
       from jsonb_array_elements(a.datos->'_tareas') t))
   where a.student_id = p_student and jsonb_typeof(a.datos->'_tareas') = 'array';
end;
$$;
revoke all on function public.mi_aula_tareas_revisadas(uuid) from public, anon;
grant execute on function public.mi_aula_tareas_revisadas(uuid) to authenticated;
