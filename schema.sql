-- Run once in Supabase SQL Editor. All public tables have row-level security.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  approved boolean not null default false,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists public.wishlists (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  content text not null default '' check (char_length(content) <= 8000),
  updated_at timestamptz not null default now()
);
create table if not exists public.exclusions (
  id bigint generated always as identity primary key,
  giver_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  unique (giver_id, recipient_id),
  check (giver_id <> recipient_id)
);
create table if not exists public.assignments (
  year integer not null default (extract(year from (now() at time zone 'America/Denver'))::integer),
  giver_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  drawn_at timestamptz not null default now(),
  primary key (year, giver_id),
  unique (year, recipient_id),
  check (giver_id <> recipient_id)
);

-- SECURITY DEFINER functions use a fixed search path and explicit object names.
create or replace function public.is_family_admin(uid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id=uid and is_admin=true);
$$;
revoke all on function public.is_family_admin(uuid) from public;
grant execute on function public.is_family_admin(uuid) to authenticated;

create or replace function public.is_approved_family_member(uid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id=uid and approved=true);
$$;
revoke all on function public.is_approved_family_member(uuid) from public;
grant execute on function public.is_approved_family_member(uuid) to authenticated;

create or replace function public.create_profile_for_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, left(coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), 'Family member'),80));
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.create_profile_for_user();

alter table public.profiles enable row level security;
alter table public.wishlists enable row level security;
alter table public.exclusions enable row level security;
alter table public.assignments enable row level security;

create policy "Profiles visible to approved family and admin" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.is_family_admin((select auth.uid())) or
         (approved = true and public.is_approved_family_member((select auth.uid()))));
-- Only the admin can change approval (or admin roles). No self-role escalation.
create policy "Admin updates profiles" on public.profiles for update to authenticated
  using (public.is_family_admin((select auth.uid())))
  with check (public.is_family_admin((select auth.uid())));

create policy "Member or assigned giver reads wish list" on public.wishlists for select to authenticated
  using (
    user_id = (select auth.uid())
    or (exists(select 1 from public.assignments a where a.giver_id=(select auth.uid()) and a.recipient_id=user_id
        and a.year=extract(year from (now() at time zone 'America/Denver'))::integer)
      and public.is_approved_family_member((select auth.uid())))
  );
create policy "Approved member creates own wish list" on public.wishlists for insert to authenticated
  with check (user_id=(select auth.uid()) and public.is_approved_family_member((select auth.uid())));
create policy "Approved member edits own wish list" on public.wishlists for update to authenticated
  using (user_id=(select auth.uid()) and public.is_approved_family_member((select auth.uid())))
  with check (user_id=(select auth.uid()));


-- Thanksgiving is the fourth Thursday of November, in the family's time zone.
-- Full editing remains available through 11:59 PM; add-only starts at midnight Friday.
create or replace function public.thanksgiving_date(y integer)
returns date language sql immutable set search_path = '' as $$
  select (pg_catalog.make_date(y, 11, 1)
    + ((4 - extract(dow from pg_catalog.make_date(y, 11, 1))::integer + 7) % 7)
    + 21);
$$;

create or replace function public.wishlist_add_only_now()
returns boolean language sql stable set search_path = '' as $$
  select (now() at time zone 'America/Denver') >=
    (public.thanksgiving_date(extract(year from (now() at time zone 'America/Denver'))::integer) + 1)::timestamp;
$$;

-- Database enforcement: even direct API calls cannot erase or change existing
-- wish-list text after the deadline. Appending to the end is still permitted.
create or replace function public.enforce_wishlist_add_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  if public.wishlist_add_only_now() and
     left(new.content, char_length(old.content)) is distinct from old.content then
    raise exception 'After Thanksgiving, existing wish-list text cannot be edited or removed; add new items only';
  end if;
  return new;
end;
$$;
drop trigger if exists wishlist_add_only_guard on public.wishlists;
create trigger wishlist_add_only_guard before update on public.wishlists
for each row execute function public.enforce_wishlist_add_only();

-- Atomic addition: locks the user's list before appending, preventing lost updates.
create or replace function public.append_wishlist(addition text)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or not public.is_approved_family_member(uid) then
    raise exception 'Not authorized';
  end if;
  if addition is null or btrim(addition) = '' then
    raise exception 'Enter an item to add';
  end if;
  insert into public.wishlists(user_id, content)
    values(uid, addition)
  on conflict(user_id) do update set
    content = public.wishlists.content || case when public.wishlists.content = '' then '' else E'\n' end || excluded.content,
    updated_at=now();
end;
$$;
revoke all on function public.append_wishlist(text) from public;
grant execute on function public.append_wishlist(text) to authenticated;

create policy "Admin reads exclusion rules" on public.exclusions for select to authenticated
  using (public.is_family_admin((select auth.uid())));
create policy "Admin adds exclusion rules" on public.exclusions for insert to authenticated
  with check (public.is_family_admin((select auth.uid())));
create policy "Admin removes exclusion rules" on public.exclusions for delete to authenticated
  using (public.is_family_admin((select auth.uid())));

-- An admin can see only their own assignment; not everyone else's.
create policy "Giver reads only own assignment" on public.assignments for select to authenticated
  using (giver_id=(select auth.uid()) and year=extract(year from (now() at time zone 'America/Denver'))::integer
    and public.is_approved_family_member((select auth.uid())));

-- An admin gets only the number of assignments, not recipients' identities.
create or replace function public.assignment_count()
returns integer language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_family_admin(auth.uid()) then
    raise exception 'Not authorized';
  end if;
  return (select count(*)::integer from public.assignments
    where year=extract(year from (now() at time zone 'America/Denver'))::integer);
end;
$$;
revoke all on function public.assignment_count() from public;
grant execute on function public.assignment_count() to authenticated;

-- Historical imported draws are stored by name because family accounts may not exist yet.
-- 2023 deliberately has zero rows: there was no family drawing that year.
create table if not exists public.historical_assignments (
  year integer not null check (year between 2000 and 2100),
  giver_name text not null,
  recipient_name text not null,
  primary key (year, giver_name),
  unique (year, recipient_name),
  check (lower(trim(giver_name)) <> lower(trim(recipient_name)))
);
alter table public.historical_assignments enable row level security;
-- Historical pairings are visible only to the authenticated organizer.
create policy "Organizer reads historical pairings" on public.historical_assignments
  for select to authenticated using (public.is_family_admin((select auth.uid())));
-- Import historical records separately from the private file included outside the public repository.

-- A historical pair is matched by case-insensitive trimmed profile display name.
-- Names must match the records above; the organizer dashboard warns about this.
create or replace function public.matches_previous_historical_pair(
  giver uuid, recipient uuid, target_year integer
) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.historical_assignments h
    join public.profiles g on lower(trim(g.display_name)) = lower(trim(h.giver_name))
    join public.profiles r on lower(trim(r.display_name)) = lower(trim(h.recipient_name))
    where g.id = giver and r.id = recipient and h.year = target_year - 1
  );
$$;
revoke all on function public.matches_previous_historical_pair(uuid,uuid,integer) from public;
-- Internal function used by the protected drawing procedure; no direct client access.

-- Server-side privileged RPC. Only the verified organizer may call it.
-- Rejection sampling produces a random valid assignment while honoring every exclusion.
create or replace function public.draw_secret_santa()
returns void language plpgsql security definer set search_path = '' as $$
declare
  people uuid[];
  shuffled uuid[];
  count_people int;
  attempt int;
  i int;
  valid_draw boolean;
  draw_year integer;
begin
  if not public.is_family_admin(auth.uid()) then
    raise exception 'Only the organizer can draw names';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(72142819);
  draw_year := extract(year from (now() at time zone 'America/Denver'))::integer;
  select array_agg(id order by id) into people from public.profiles where approved=true;
  count_people := coalesce(array_length(people,1),0);
  if count_people < 2 then raise exception 'Approve at least two family members first'; end if;
  for attempt in 1..10000 loop
    select array_agg(id order by random()) into shuffled from unnest(people) id;
    valid_draw := true;
    for i in 1..count_people loop
      if people[i] = shuffled[i] or exists (
        select 1 from public.exclusions e where e.giver_id=people[i] and e.recipient_id=shuffled[i]
      ) or exists (
        select 1 from public.assignments previous
        where previous.year=draw_year-1 and previous.giver_id=people[i]
          and previous.recipient_id=shuffled[i]
      ) or public.matches_previous_historical_pair(people[i], shuffled[i], draw_year) then
        valid_draw := false;
        exit;
      end if;
    end loop;
    if valid_draw then
      delete from public.assignments where year=draw_year;
      for i in 1..count_people loop
        insert into public.assignments (year, giver_id, recipient_id) values (draw_year,people[i],shuffled[i]);
      end loop;
      return;
    end if;
  end loop;
  raise exception 'No valid draw found after 10,000 attempts. Review restrictions and last year''s pairings.';
end;
$$;
revoke all on function public.draw_secret_santa() from public;
grant execute on function public.draw_secret_santa() to authenticated;

-- First-time setup AFTER YOU sign up and verify your email:
-- update public.profiles set is_admin = true, approved = true
-- where id = (select id from auth.users where email = 'YOUR_EMAIL_HERE');
