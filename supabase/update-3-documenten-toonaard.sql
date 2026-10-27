-- =====================================================================
--  Bandstem update 3: documenten (partituren e.d.) en toonaard per nummer
--  Alleen nodig als je setup.sql al eerder hebt uitgevoerd.
--  Plak dit in Supabase > SQL Editor > New query > Run.
--  Je stemmen, namen, codes en commentaren blijven gewoon staan.
-- =====================================================================

-- ---------- Toonaard bij nummers op de lijst "We spelen" ----------
alter table public.band_playing add column if not exists key_changed  boolean;          -- null = nog niet aangegeven
alter table public.band_playing add column if not exists key_original text check (char_length(key_original) <= 20);
alter table public.band_playing add column if not exists key_played   text check (char_length(key_played) <= 20);
alter table public.band_playing add column if not exists key_by       uuid references public.band_members(id) on delete set null;
alter table public.band_playing add column if not exists key_at       timestamptz;

drop policy if exists "leden wijzigen toonaard" on public.band_playing;
create policy "leden wijzigen toonaard" on public.band_playing for update to authenticated
  using (public.band_my_member_id() is not null)
  with check (public.band_my_member_id() is not null and (key_by is null or key_by = public.band_my_member_id()));
-- Alleen de toonaard-kolommen mogen gewijzigd worden
revoke update on public.band_playing from authenticated;
grant update (key_changed, key_original, key_played, key_by, key_at) on public.band_playing to authenticated;

-- ---------- Documenten ----------
create table if not exists public.band_documents (
  id          bigint generated always as identity primary key,
  song_id     text references public.band_songs(spotify_id) on delete cascade,   -- null = algemeen banddocument
  member_id   uuid references public.band_members(id) on delete set null,
  name        text not null check (char_length(name) between 1 and 200),
  path        text not null unique,
  size_bytes  bigint,
  mime        text,
  created_at  timestamptz not null default now()
);
create index if not exists band_documents_song_idx on public.band_documents (song_id, created_at);

alter table public.band_documents enable row level security;
drop policy if exists "leden lezen documenten"    on public.band_documents;
drop policy if exists "leden voegen document toe" on public.band_documents;
drop policy if exists "eigen document wissen"     on public.band_documents;
create policy "leden lezen documenten"    on public.band_documents for select to authenticated using (public.band_my_member_id() is not null);
create policy "leden voegen document toe" on public.band_documents for insert to authenticated with check (member_id = public.band_my_member_id());
create policy "eigen document wissen"     on public.band_documents for delete to authenticated using (member_id = public.band_my_member_id());
revoke all on public.band_documents from anon;
grant select, insert, delete on public.band_documents to authenticated;
grant all on public.band_documents to service_role;

-- Opslagplaats voor de bestanden (privé; max. 25 MB per bestand)
insert into storage.buckets (id, name, public, file_size_limit)
values ('band-docs', 'band-docs', false, 26214400)
on conflict (id) do update set public = false, file_size_limit = 26214400;

drop policy if exists "bandstem leden lezen bestanden"   on storage.objects;
drop policy if exists "bandstem leden uploaden"          on storage.objects;
drop policy if exists "bandstem eigen bestand wissen"    on storage.objects;
create policy "bandstem leden lezen bestanden" on storage.objects for select to authenticated
  using (bucket_id = 'band-docs' and public.band_my_member_id() is not null);
create policy "bandstem leden uploaden" on storage.objects for insert to authenticated
  with check (bucket_id = 'band-docs' and public.band_my_member_id() is not null);
create policy "bandstem eigen bestand wissen" on storage.objects for delete to authenticated
  using (bucket_id = 'band-docs' and exists (
    select 1 from public.band_documents d
    where d.path = storage.objects.name and d.member_id = public.band_my_member_id()));

-- Live bijwerken
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'band_documents') then
    alter publication supabase_realtime add table public.band_documents;
  end if;
end $$;
