-- Set the eight requested lesson titles in the Vibe Tools course.
-- Run in Supabase SQL Editor. Safe to rerun: the first three lessons are
-- renamed by order, and lessons 4–8 are inserted only when their title is absent.
begin;

with target as (
  select '4ce37d75-aaa0-46aa-ab43-0f21ece1a635'::uuid as course_id
), first_three as (
  select l.id,
         row_number() over (order by l.position, l.id) as n
  from public.course_lessons l
  join target t on t.course_id = l.course_id
  order by l.position, l.id
  limit 3
), names(n, title) as (
  values
    (1, 'What are we building and how?'),
    (2, 'Meet GitHub'),
    (3, 'GitHub Desktop')
)
update public.course_lessons l
set title = names.title
from first_three f
join names using (n)
where l.id = f.id;

with target as (
  select '4ce37d75-aaa0-46aa-ab43-0f21ece1a635'::uuid as course_id
), desired(title, n) as (
  values
    ('Install your vibe tools', 4),
    ('Launching your web', 5),
    ('Editing your website with AI', 6),
    ('Enhancing your workflow with AI', 7),
    ('Create your web domain!', 8)
), missing as (
  select d.title, d.n
  from desired d
  cross join target t
  where not exists (
    select 1 from public.course_lessons l
    where l.course_id = t.course_id and l.title = d.title
  )
), base as (
  select coalesce(max(l.position), 0) as max_position,
         (array_agg(l.section order by l.position) filter (where l.id is not null))[1] as section
  from target t
  left join public.course_lessons l on l.course_id = t.course_id
)
insert into public.course_lessons (course_id, section, title, position, kind, is_free)
select t.course_id, b.section, m.title, b.max_position + row_number() over (order by m.n), 'video', false
from target t
cross join base b
cross join missing m
order by m.n;

commit;
