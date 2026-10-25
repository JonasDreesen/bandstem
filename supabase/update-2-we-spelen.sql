-- =====================================================================
--  Bandstem update 2: lijst "We spelen" met commentaren per nummer
--  Alleen nodig als je setup.sql al eerder hebt uitgevoerd.
--  Plak dit in Supabase > SQL Editor > New query > Run.
--  Je stemmen, namen en codes blijven gewoon staan.
-- =====================================================================

-- Nummers die de band aan het spelen / instuderen is
create table if not exists public.band_playing (
  song_id   text primary key references public.band_songs(spotify_id) on delete cascade,
  added_by  uuid references public.band_members(id) on delete set null,
  added_at  timestamptz not null default now()
);

-- Commentaren bij een nummer
create table if not exists public.band_comments (
  id          bigint generated always as identity primary key,
  song_id     text not null references public.band_songs(spotify_id) on delete cascade,
  member_id   uuid not null references public.band_members(id) on delete cascade,
  body        text not null check (char_length(trim(body)) between 1 and 1000),
  created_at  timestamptz not null default now()
);
create index if not exists band_comments_song_idx on public.band_comments (song_id, created_at);

alter table public.band_playing  enable row level security;
alter table public.band_comments enable row level security;

drop policy if exists "leden lezen lijst"        on public.band_playing;
drop policy if exists "leden zetten op lijst"    on public.band_playing;
drop policy if exists "leden halen van lijst"    on public.band_playing;
drop policy if exists "leden lezen commentaar"   on public.band_comments;
drop policy if exists "eigen commentaar plaatsen" on public.band_comments;
drop policy if exists "eigen commentaar wissen"  on public.band_comments;

create policy "leden lezen lijst"         on public.band_playing  for select to authenticated using (public.band_my_member_id() is not null);
create policy "leden zetten op lijst"     on public.band_playing  for insert to authenticated with check (added_by = public.band_my_member_id());
create policy "leden halen van lijst"     on public.band_playing  for delete to authenticated using (public.band_my_member_id() is not null);
create policy "leden lezen commentaar"    on public.band_comments for select to authenticated using (public.band_my_member_id() is not null);
create policy "eigen commentaar plaatsen" on public.band_comments for insert to authenticated with check (member_id = public.band_my_member_id());
create policy "eigen commentaar wissen"   on public.band_comments for delete to authenticated using (member_id = public.band_my_member_id());

revoke all on public.band_playing, public.band_comments from anon;
grant select, insert, delete on public.band_playing, public.band_comments to authenticated;
grant all on public.band_playing, public.band_comments to service_role;

-- Live bijwerken
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['band_playing', 'band_comments'] loop
      if not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
