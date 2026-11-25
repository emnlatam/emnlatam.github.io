-- Berkli Bot: text of the Berklee admissions pages, their link map, and a search function.
-- Read: any signed-in user (the chat on /berkli-bot). Write: only the service role
-- (crawler on Daniel's PC) and staff (board edits). RLS stays ON.

create table if not exists public.berkli_pages (
  url text primary key,
  title text not null default '',
  text text not null default '',
  parent_url text,
  depth int not null default 0,
  content_hash text not null default '',
  prev_text text,
  status text not null default 'ok' check (status in ('ok','changed','gone','error','manual')),
  first_seen timestamptz not null default now(),
  last_checked timestamptz not null default now(),
  last_changed timestamptz,
  board_x int,
  board_y int,
  fts tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(text, '')), 'B')
  ) stored
);
create index if not exists berkli_pages_fts_idx on public.berkli_pages using gin (fts);

create table if not exists public.berkli_links (
  from_url text not null references public.berkli_pages(url) on delete cascade,
  to_url text not null references public.berkli_pages(url) on delete cascade,
  label text not null default '',
  primary key (from_url, to_url)
);

alter table public.berkli_pages enable row level security;
alter table public.berkli_links enable row level security;

drop policy if exists berkli_pages_read on public.berkli_pages;
drop policy if exists berkli_pages_staff_write on public.berkli_pages;
drop policy if exists berkli_links_read on public.berkli_links;
drop policy if exists berkli_links_staff_write on public.berkli_links;
create policy berkli_pages_read on public.berkli_pages for select to authenticated using (true);
create policy berkli_pages_staff_write on public.berkli_pages for all to authenticated
  using (public.emn_is_staff()) with check (public.emn_is_staff());
create policy berkli_links_read on public.berkli_links for select to authenticated using (true);
create policy berkli_links_staff_write on public.berkli_links for all to authenticated
  using (public.emn_is_staff()) with check (public.emn_is_staff());

-- Best matching pages for a question (used by the Edge Function berkli-chat).
create or replace function public.berkli_search(q text, lim int default 5)
returns table (url text, title text, text text, rank real)
language sql stable security invoker set search_path = public as $$
  select p.url, p.title, p.text, ts_rank(p.fts, websearch_to_tsquery('english', q)) as rank
  from public.berkli_pages p
  where p.status <> 'gone'
    and p.fts @@ websearch_to_tsquery('english', q)
  order by rank desc
  limit greatest(1, least(lim, 10));
$$;

-- Every page where at least one search word (or a stem of it) appears, best match first. No page text, only links.
create or replace function public.berkli_related(q text, lim int default 40)
returns table (url text, title text, rank real)
language sql stable security invoker set search_path = public as $$
  select p.url, p.title, ts_rank(p.fts, websearch_to_tsquery('english', q)) as rank
  from public.berkli_pages p
  where p.status <> 'gone'
    and p.fts @@ websearch_to_tsquery('english', q)
  order by rank desc
  limit greatest(1, least(lim, 60));
$$;
grant execute on function public.berkli_related(text, int) to authenticated;
