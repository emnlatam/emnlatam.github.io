-- Jobiut: private job-offer comparator (/jobiut). Each row belongs to one signed-in staff user.
create table if not exists public.jobiut_offers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null default 'Nueva oferta' check (char_length(name) <= 200),
  score int not null default 0 check (score between 0 and 100),
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists jobiut_offers_user_idx on public.jobiut_offers (user_id, updated_at desc);
alter table public.jobiut_offers enable row level security;

drop policy if exists jobiut_select on public.jobiut_offers;
drop policy if exists jobiut_insert on public.jobiut_offers;
drop policy if exists jobiut_update on public.jobiut_offers;
drop policy if exists jobiut_delete on public.jobiut_offers;
create policy jobiut_select on public.jobiut_offers for select to authenticated
  using (user_id = auth.uid() and public.emn_is_staff());
create policy jobiut_insert on public.jobiut_offers for insert to authenticated
  with check (user_id = auth.uid() and public.emn_is_staff());
create policy jobiut_update on public.jobiut_offers for update to authenticated
  using (user_id = auth.uid() and public.emn_is_staff())
  with check (user_id = auth.uid() and public.emn_is_staff());
create policy jobiut_delete on public.jobiut_offers for delete to authenticated
  using (user_id = auth.uid() and public.emn_is_staff());
