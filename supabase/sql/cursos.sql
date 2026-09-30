-- EMN Cursos — tablas para los cursos en video (/cursos).
-- Ejecutar una sola vez en Supabase → SQL Editor (proyecto gpoddvcrsdkpgfmyniqu).
--
-- OJO: a diferencia del resto de la app (RLS desactivado, permisos solo en el
-- frontend), estas tablas SÍ usan RLS: es lo único que impide que alguien con
-- la anon key lea los links de los videos sin haber recibido acceso.

-- ¿La persona que hace la consulta es admin o profesor?
create or replace function public.emn_is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from students where id = auth.uid() and role in ('admin','professor'));
$$;

create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  cover_url text,
  position int not null default 0,
  payment_url text,           -- Stripe Payment Link del botón "Desbloquear curso"
  published boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.course_lessons (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  section text,               -- nombre del módulo; las clases seguidas con el mismo nombre se agrupan
  title text not null,
  description text,
  duration_min int,
  position int not null default 0,
  is_free boolean not null default false,  -- clase de muestra: su contenido lo ve cualquiera
  kind text not null default 'video' check (kind in ('video','quiz'))
);

-- El contenido de la clase vive aparte: el temario (course_lessons) es
-- público, pero el video o el quiz solo lo recibe quien tiene acceso.
create table if not exists public.lesson_videos (
  lesson_id uuid primary key references public.course_lessons(id) on delete cascade,
  video_url text,             -- link de YouTube, Vimeo, Bunny Stream o un .mp4
  quiz jsonb                  -- [{q, options:[…], correct:<índice>}] cuando kind = 'quiz'
);

create table if not exists public.course_access (
  student_id uuid not null references public.students(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  granted_at timestamptz not null default now(),
  primary key (student_id, course_id)
);

create table if not exists public.lesson_progress (
  student_id uuid not null references public.students(id) on delete cascade,
  lesson_id uuid not null references public.course_lessons(id) on delete cascade,
  completed_at timestamptz not null default now(),
  score int,                  -- solo quizzes: respuestas correctas del último intento
  total int,
  primary key (student_id, lesson_id)
);

alter table public.courses enable row level security;
alter table public.course_lessons enable row level security;
alter table public.lesson_videos enable row level security;
alter table public.course_access enable row level security;
alter table public.lesson_progress enable row level security;

-- Catálogo: cualquiera ve los cursos publicados (título, portada, descripción).
create policy "courses_read" on public.courses for select
  using (published or public.emn_is_staff());
create policy "courses_staff_write" on public.courses for all
  using (public.emn_is_staff()) with check (public.emn_is_staff());

-- Temario: cualquiera ve los títulos de las clases de un curso publicado.
create policy "lessons_read" on public.course_lessons for select
  using (public.emn_is_staff() or exists(
    select 1 from public.courses c where c.id = course_lessons.course_id and c.published));
create policy "lessons_staff_write" on public.course_lessons for all
  using (public.emn_is_staff()) with check (public.emn_is_staff());

-- Videos: clases gratis para cualquiera; el resto solo con acceso al curso, o staff.
create policy "videos_read" on public.lesson_videos for select
  using (public.emn_is_staff() or exists(
    select 1 from public.course_lessons l
    where l.id = lesson_videos.lesson_id
      and (l.is_free or exists(
        select 1 from public.course_access a
        where a.course_id = l.course_id and a.student_id = auth.uid()))));
create policy "videos_staff_write" on public.lesson_videos for all
  using (public.emn_is_staff()) with check (public.emn_is_staff());

-- Accesos: cada quien ve los suyos; solo staff los da o los quita.
create policy "access_read" on public.course_access for select
  using (student_id = auth.uid() or public.emn_is_staff());
create policy "access_staff_write" on public.course_access for all
  using (public.emn_is_staff()) with check (public.emn_is_staff());

-- Progreso: cada quien maneja el suyo; staff puede verlo.
create policy "progress_own" on public.lesson_progress for all
  using (student_id = auth.uid()) with check (student_id = auth.uid());
create policy "progress_staff_read" on public.lesson_progress for select
  using (public.emn_is_staff());

-- Candado del rol. `students` no tiene RLS, así que sin esto cualquier alumno
-- con sesión podría cambiarse a sí mismo a 'admin' desde la consola del
-- navegador y saltarse todo lo de arriba. Las Edge Functions (service role,
-- auth.uid() nulo) y el staff siguen pudiendo cambiar roles con normalidad.
create or replace function public.emn_guard_student_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.emn_is_staff() then
    if tg_op = 'INSERT' and new.role is distinct from 'student' then
      raise exception 'Solo un admin puede asignar roles';
    elsif tg_op = 'UPDATE' and new.role is distinct from old.role then
      raise exception 'Solo un admin puede cambiar roles';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists emn_guard_student_role on public.students;
create trigger emn_guard_student_role before insert or update on public.students
  for each row execute function public.emn_guard_student_role();

-- Para poner el video de una clase:
-- insert into public.lesson_videos (lesson_id, video_url)
-- values ('<id de la clase>', 'https://vimeo.com/...')
-- on conflict (lesson_id) do update set video_url = excluded.video_url;
