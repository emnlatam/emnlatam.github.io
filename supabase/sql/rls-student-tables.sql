-- RLS for the student tables (fixes Supabase advisor "rls_disabled_in_public", 2026-11-04).
-- Rule: a student reads/writes only their own rows; staff (admin/professor, public.emn_is_staff()) everything.
-- Requires public.emn_is_staff() from cursos.sql.

alter table public.students enable row level security;
alter table public.practice_activity enable row level security;
alter table public.career_todos enable row level security;
alter table public.career_progress enable row level security;
alter table public.interview_prep_prelim_answers enable row level security;
alter table public.interview_prep_final_answers enable row level security;

-- students: own row or staff. A student may update their own row but never change their role.
create policy "students_ver" on public.students
  for select to authenticated using (id = auth.uid() or public.emn_is_staff());
create policy "students_staff_todo" on public.students
  for all to authenticated using (public.emn_is_staff()) with check (public.emn_is_staff());
create policy "students_editar_propio" on public.students
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and role = (select s.role from public.students s where s.id = auth.uid()));

-- per-student tables
create policy "practice_activity_propio" on public.practice_activity
  for all to authenticated
  using (student_id = auth.uid() or public.emn_is_staff())
  with check (student_id = auth.uid() or public.emn_is_staff());

create policy "career_todos_propio" on public.career_todos
  for all to authenticated
  using (user_id = auth.uid() or public.emn_is_staff())
  with check (user_id = auth.uid() or public.emn_is_staff());

create policy "career_progress_propio" on public.career_progress
  for all to authenticated
  using (student_id = auth.uid() or public.emn_is_staff())
  with check (student_id = auth.uid() or public.emn_is_staff());

create policy "interview_prelim_propio" on public.interview_prep_prelim_answers
  for all to authenticated
  using (student_id = auth.uid() or public.emn_is_staff())
  with check (student_id = auth.uid() or public.emn_is_staff());

create policy "interview_final_propio" on public.interview_prep_final_answers
  for all to authenticated
  using (student_id = auth.uid() or public.emn_is_staff())
  with check (student_id = auth.uid() or public.emn_is_staff());
