-- Vibe Tools course: 8 sections, one video each. Run in Supabase SQL Editor.
-- Rewrites the course outline by lesson id (the original six lessons) and
-- inserts sections 5-8 only when absent. Safe to rerun.
begin;

-- Drop "Arma la estructura…" and "Diseño, fotos y contenido".
delete from public.course_lessons
where id in ('5a352ca1-0f57-458c-b156-8afe80a701f6','879888ec-f110-48ba-bb4b-529529caad19');

update public.course_lessons set section='What are we building and how?', title='What are we building and how?', position=1
  where id='1b24f8a7-9e55-41c8-9bc4-ece16aa70fea';
update public.course_lessons set section='Meet GitHub', title='Meet GitHub', position=2
  where id='5b5babdb-3721-4b7d-905e-bc978ac71682';
update public.course_lessons set section='GitHub Desktop', title='GitHub Desktop', position=3
  where id='c1350eea-7449-4c6a-a989-4d027d7d16f2';
update public.course_lessons set section='Install your Vibe tools', title='Install your Vibe tools', position=4
  where id='4b268c5f-c842-45c1-a3a3-0a3bd8e259f4';

insert into public.course_lessons (course_id, section, title, position, kind, is_free)
select '4ce37d75-aaa0-46aa-ab43-0f21ece1a635', v.t, v.t, v.p, 'video', false
from (values
  ('Launching your web', 5),
  ('Editing your website with AI', 6),
  ('Enhancing your workflow with AI', 7),
  ('Create your web domain!', 8)
) v(t, p)
where not exists (
  select 1 from public.course_lessons l
  where l.course_id = '4ce37d75-aaa0-46aa-ab43-0f21ece1a635' and l.title = v.t
);

commit;
