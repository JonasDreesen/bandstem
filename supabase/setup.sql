-- =====================================================================
--  Bandstem: database-opzet voor Supabase
--  Plak dit hele bestand in Supabase > SQL Editor > New query > Run.
--  Je kunt het veilig opnieuw uitvoeren; bestaande stemmen en codes blijven staan.
--
--  PAS EERST DEZE TWEE CODES AAN (onderaan in het blok "Codes instellen"):
--    band_code  : de code die je bandleden intypen om binnen te komen
--    admin_code : alleen voor jou, om Spotify te koppelen
-- =====================================================================

-- ---------- Tabellen ----------

create table if not exists public.band_settings (
  id                     int primary key default 1 check (id = 1),
  band_code              text not null,
  admin_code             text not null,
  playlist_id            text,
  playlist_name          text,
  spotify_refresh_token  text,
  last_sync              timestamptz,
  last_sync_error        text
);

create table if not exists public.band_members (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  instrument  text not null default 'zang'
              check (instrument in ('zang','gitaar','bas','drums','piano','coach')),
  created_at  timestamptz not null default now()
);
create unique index if not exists band_members_name_key on public.band_members (lower(name));

-- Koppelt een toestel (anonieme login) aan een bandlid.
create table if not exists public.band_devices (
  uid        uuid primary key,
  member_id  uuid not null references public.band_members(id) on delete cascade,
  linked_at  timestamptz not null default now()
);

create table if not exists public.band_songs (
  spotify_id   text primary key,
  title        text not null,
  artists      text not null,
  album        text,
  image_url    text,
  duration_ms  int,
  added_at     timestamptz,
  position     int,
  removed      boolean not null default false,
  first_seen   timestamptz not null default now(),
  synced_at    timestamptz not null default now()
);

create table if not exists public.band_votes (
  member_id   uuid not null references public.band_members(id) on delete cascade,
  song_id     text not null references public.band_songs(spotify_id) on delete cascade,
  vote        text check (vote in ('super','yes','maybe','no')),
  difficulty  smallint check (difficulty between 1 and 3),
  comment     text check (char_length(comment) <= 500),
  updated_at  timestamptz not null default now(),
  primary key (member_id, song_id)
);

-- ---------- Hulpfunctie: welk bandlid is deze bezoeker? ----------

create or replace function public.band_my_member_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select member_id from public.band_devices where uid = auth.uid()
$$;

-- ---------- Beveiliging (Row Level Security) ----------

alter table public.band_settings enable row level security;   -- geen policies: niemand leest dit rechtstreeks
alter table public.band_members  enable row level security;
alter table public.band_devices  enable row level security;
alter table public.band_songs    enable row level security;
alter table public.band_votes    enable row level security;

drop policy if exists "leden lezen leden"     on public.band_members;
drop policy if exists "eigen toestel"         on public.band_devices;
drop policy if exists "leden lezen nummers"   on public.band_songs;
drop policy if exists "leden lezen stemmen"   on public.band_votes;
drop policy if exists "eigen stem toevoegen"  on public.band_votes;
drop policy if exists "eigen stem wijzigen"   on public.band_votes;
drop policy if exists "eigen stem wissen"     on public.band_votes;

create policy "leden lezen leden"    on public.band_members for select to authenticated using (public.band_my_member_id() is not null);
create policy "eigen toestel"        on public.band_devices for select to authenticated using (uid = auth.uid());
create policy "leden lezen nummers"  on public.band_songs   for select to authenticated using (public.band_my_member_id() is not null);
create policy "leden lezen stemmen"  on public.band_votes   for select to authenticated using (public.band_my_member_id() is not null);
create policy "eigen stem toevoegen" on public.band_votes   for insert to authenticated with check (member_id = public.band_my_member_id());
create policy "eigen stem wijzigen"  on public.band_votes   for update to authenticated using (member_id = public.band_my_member_id()) with check (member_id = public.band_my_member_id());
create policy "eigen stem wissen"    on public.band_votes   for delete to authenticated using (member_id = public.band_my_member_id());

revoke all on public.band_settings from anon, authenticated;
revoke all on public.band_members, public.band_devices, public.band_songs, public.band_votes from anon;
grant select on public.band_members, public.band_devices, public.band_songs to authenticated;
grant select, insert, update, delete on public.band_votes to authenticated;
grant all on public.band_settings, public.band_members, public.band_devices, public.band_songs, public.band_votes to service_role;

-- ---------- Functies die de website aanroept ----------

-- Stap 1 van inloggen: klopt de code? Zo ja, toon wie er al in de band zit.
create or replace function public.band_check_code(p_code text)
returns json
language plpgsql stable security definer set search_path = public
as $$
declare ok boolean;
begin
  select lower(trim(p_code)) = lower(trim(band_code)) into ok from public.band_settings where id = 1;
  if not coalesce(ok, false) then
    return json_build_object('ok', false);
  end if;
  return json_build_object(
    'ok', true,
    'members', coalesce((select json_agg(json_build_object('name', name, 'instrument', instrument) order by created_at)
                         from public.band_members), '[]'::json)
  );
end $$;

-- Stap 2 van inloggen: koppel dit toestel aan een (nieuw of bestaand) bandlid.
create or replace function public.band_join(p_code text, p_name text, p_instrument text default null)
returns json
language plpgsql volatile security definer set search_path = public
as $$
declare
  ok boolean;
  m public.band_members;
  clean_name text := trim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
begin
  if auth.uid() is null then raise exception 'niet aangemeld'; end if;
  select lower(trim(p_code)) = lower(trim(band_code)) into ok from public.band_settings where id = 1;
  if not coalesce(ok, false) then raise exception 'verkeerde bandcode'; end if;
  if char_length(clean_name) < 1 or char_length(clean_name) > 30 then raise exception 'ongeldige naam'; end if;

  select * into m from public.band_members where lower(name) = lower(clean_name);
  if m.id is null then
    insert into public.band_members (name, instrument)
    values (clean_name, coalesce(p_instrument, 'zang'))
    returning * into m;
  elsif p_instrument is not null and p_instrument <> m.instrument then
    update public.band_members set instrument = p_instrument where id = m.id returning * into m;
  end if;

  insert into public.band_devices (uid, member_id) values (auth.uid(), m.id)
  on conflict (uid) do update set member_id = excluded.member_id, linked_at = now();

  return json_build_object('id', m.id, 'name', m.name, 'instrument', m.instrument);
end $$;

-- Instrument van jezelf aanpassen.
create or replace function public.band_set_instrument(p_instrument text)
returns void
language plpgsql volatile security definer set search_path = public
as $$
begin
  if public.band_my_member_id() is null then raise exception 'geen bandlid'; end if;
  update public.band_members set instrument = p_instrument where id = public.band_my_member_id();
end $$;

-- Status van de Spotify-koppeling (voor de leden zichtbaar).
create or replace function public.band_status()
returns json
language plpgsql stable security definer set search_path = public
as $$
begin
  if public.band_my_member_id() is null then return null; end if;
  return (select json_build_object(
            'playlist_id', playlist_id,
            'playlist_name', playlist_name,
            'connected', spotify_refresh_token is not null,
            'last_sync', last_sync,
            'last_sync_error', last_sync_error)
          from public.band_settings where id = 1);
end $$;

-- Interne functie: zet de nummerlijst gelijk met Spotify.
-- p_songs is een JSON-lijst van {spotify_id,title,artists,album,image_url,duration_ms,added_at,position}.
create or replace function public.band_apply_sync(p_songs jsonb, p_playlist_name text)
returns int
language plpgsql volatile security definer set search_path = public
as $$
declare n int;
begin
  insert into public.band_songs (spotify_id, title, artists, album, image_url, duration_ms, added_at, position, removed, synced_at)
  select s->>'spotify_id', s->>'title', s->>'artists', s->>'album', s->>'image_url',
         nullif(s->>'duration_ms','')::int, nullif(s->>'added_at','')::timestamptz,
         nullif(s->>'position','')::int, false, now()
  from jsonb_array_elements(p_songs) s
  where coalesce(s->>'spotify_id','') <> ''
  on conflict (spotify_id) do update set
    title = excluded.title, artists = excluded.artists, album = excluded.album,
    image_url = excluded.image_url, duration_ms = excluded.duration_ms,
    added_at = excluded.added_at, position = excluded.position,
    removed = false, synced_at = now();
  get diagnostics n = row_count;

  -- Nummers die uit de playlist verdwenen zijn: verbergen, stemmen bewaren.
  update public.band_songs set removed = true
  where spotify_id not in (select s->>'spotify_id' from jsonb_array_elements(p_songs) s where coalesce(s->>'spotify_id','') <> '');

  update public.band_settings
  set last_sync = now(), last_sync_error = null,
      playlist_name = coalesce(p_playlist_name, playlist_name)
  where id = 1;
  return n;
end $$;

-- Gebruikt door de koppelpagina: refresh token en playlist opslaan (met admin-code).
create or replace function public.band_admin_connect(p_admin_code text, p_refresh_token text, p_playlist_id text, p_playlist_name text)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare ok boolean;
begin
  select p_admin_code = admin_code into ok from public.band_settings where id = 1;
  if not coalesce(ok, false) then raise exception 'verkeerde admin-code'; end if;
  update public.band_settings
  set spotify_refresh_token = coalesce(p_refresh_token, spotify_refresh_token),
      playlist_id = p_playlist_id,
      playlist_name = p_playlist_name
  where id = 1;
end $$;

-- Gebruikt door de koppelpagina: meteen een eerste keer synchroniseren (met admin-code).
create or replace function public.band_admin_sync(p_admin_code text, p_songs jsonb, p_playlist_name text)
returns int
language plpgsql volatile security definer set search_path = public
as $$
declare ok boolean;
begin
  select p_admin_code = admin_code into ok from public.band_settings where id = 1;
  if not coalesce(ok, false) then raise exception 'verkeerde admin-code'; end if;
  return public.band_apply_sync(p_songs, p_playlist_name);
end $$;

-- Rechten op functies
revoke execute on function public.band_my_member_id()                      from public, anon;
revoke execute on function public.band_apply_sync(jsonb, text)             from public, anon, authenticated;
revoke execute on function public.band_check_code(text)                    from public;
revoke execute on function public.band_join(text, text, text)              from public, anon;
revoke execute on function public.band_set_instrument(text)                from public, anon;
revoke execute on function public.band_status()                            from public, anon;
revoke execute on function public.band_admin_connect(text, text, text, text) from public;
revoke execute on function public.band_admin_sync(text, jsonb, text)       from public;

grant execute on function public.band_my_member_id()                      to authenticated;
grant execute on function public.band_check_code(text)                    to anon, authenticated;
grant execute on function public.band_join(text, text, text)              to authenticated;
grant execute on function public.band_set_instrument(text)                to authenticated;
grant execute on function public.band_status()                            to authenticated;
grant execute on function public.band_admin_connect(text, text, text, text) to anon, authenticated;
grant execute on function public.band_admin_sync(text, jsonb, text)       to anon, authenticated;
grant execute on function public.band_apply_sync(jsonb, text)             to service_role;

-- Live bijwerken van stemmen (Realtime)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'band_votes') then
    alter publication supabase_realtime add table public.band_votes;
  end if;
end $$;

-- ---------- Superlike-limiet en coach (ook voor oudere installaties) ----------
-- Coach als "instrument" toelaten
alter table public.band_members drop constraint if exists band_members_instrument_check;
alter table public.band_members add constraint band_members_instrument_check
  check (instrument in ('zang','gitaar','bas','drums','piano','coach'));

-- Superlike als stem toelaten
alter table public.band_votes drop constraint if exists band_votes_vote_check;
alter table public.band_votes add constraint band_votes_vote_check
  check (vote in ('super','yes','maybe','no'));

-- Maximaal 3 superlikes per persoon
create or replace function public.band_superlike_limit()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.vote = 'super' and (
       select count(*) from public.band_votes
       where member_id = new.member_id and vote = 'super' and song_id <> new.song_id
     ) >= 3 then
    raise exception 'superlike-limiet: je hebt al 3 superlikes gegeven' using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke execute on function public.band_superlike_limit() from public, anon, authenticated;

drop trigger if exists band_superlike_limit on public.band_votes;
create trigger band_superlike_limit
  before insert or update of vote on public.band_votes
  for each row execute function public.band_superlike_limit();

-- ---------- Lijst 'We spelen' en commentaren ----------
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

-- ---------- Codes instellen (PAS AAN) ----------
insert into public.band_settings (id, band_code, admin_code)
values (1, 'KIES-EEN-BANDCODE', 'KIES-EEN-ADMINCODE')
on conflict (id) do nothing;  -- bestaande codes blijven staan als je dit script opnieuw uitvoert
-- Codes later wijzigen? Gebruik:
-- update public.band_settings set band_code = 'nieuwe-bandcode', admin_code = 'nieuwe-admincode' where id = 1;
