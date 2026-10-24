-- =====================================================================
--  Bandstem update 1: superlike (max. 3 per persoon) en de rol "coach"
--  Alleen nodig als je setup.sql al eerder hebt uitgevoerd.
--  Plak dit in Supabase > SQL Editor > New query > Run.
--  Je stemmen, namen en codes blijven gewoon staan.
-- =====================================================================

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
