create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null
);

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code_hash text,
  invite_expires_at timestamptz
);

create table if not exists public.org_members (
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  is_owner boolean not null default false,
  roles text[] not null default '{}'
    check (roles <@ array['processor', 'approver', 'treasury']),
  primary key (org_id, user_id)
);

-- One org per user in this phase
create unique index if not exists org_members_user_unique on public.org_members (user_id);

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.org_members enable row level security;

create or replace function public.is_org_member(org uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from org_members m
    where m.org_id = org and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_org_owner(org uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from org_members m
    where m.org_id = org and m.user_id = auth.uid() and m.is_owner
  );
$$;

create policy "read own profile" on public.profiles
  for select using (id = auth.uid());
create policy "update own profile" on public.profiles
  for update using (id = auth.uid());
create policy "insert own profile" on public.profiles
  for insert with check (id = auth.uid());

create policy "members read org" on public.organizations
  for select using (public.is_org_member(id));
create policy "owners update org invite" on public.organizations
  for update using (public.is_org_owner(id));

create policy "members read membership" on public.org_members
  for select using (public.is_org_member(org_id));
create policy "owners update membership" on public.org_members
  for update using (public.is_org_owner(org_id));

-- Create org + owner membership in one call (signup path)
create or replace function public.create_org_with_owner(
  org_name text,
  profile_name text,
  initial_roles text[]
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  new_org uuid;
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated'; end if;
  insert into public.profiles (id, display_name) values (uid, profile_name)
    on conflict (id) do update set display_name = excluded.display_name;
  insert into public.organizations (name) values (org_name) returning id into new_org;
  insert into public.org_members (org_id, user_id, is_owner, roles)
    values (new_org, uid, true, initial_roles);
  return new_org;
end;
$$;

-- Join with invite code (plaintext code; server hashes compare)
create or replace function public.join_org_with_invite(
  invite_code text,
  profile_name text,
  default_roles text[]
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  uid uuid := auth.uid();
  target public.organizations%rowtype;
  code_hash text;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  -- Hash matches client SHA-256 hex of the code (see invite.ts)
  code_hash := encode(extensions.digest(invite_code, 'sha256'), 'hex');
  select * into target from public.organizations
    where invite_code_hash = code_hash
      and invite_expires_at > now()
    limit 1;
  if not found then raise exception 'invalid or expired invite'; end if;
  insert into public.profiles (id, display_name) values (uid, profile_name)
    on conflict (id) do update set display_name = excluded.display_name;
  insert into public.org_members (org_id, user_id, is_owner, roles)
    values (target.id, uid, false, default_roles);
  return target.id;
end;
$$;

-- Owner sets invite code (stores sha256 hex + expiry)
create or replace function public.set_invite_code(
  org uuid,
  code_hash text,
  expires_at timestamptz
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_org_owner(org) then raise exception 'not owner'; end if;
  update public.organizations
    set invite_code_hash = set_invite_code.code_hash,
        invite_expires_at = set_invite_code.expires_at
    where id = org;
end;
$$;

-- Owner clears invite (single-use: join already leaves code until regenerate; clear after join optional)
create or replace function public.clear_invite(org uuid) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_org_owner(org) then raise exception 'not owner'; end if;
  update public.organizations
    set invite_code_hash = null, invite_expires_at = null
    where id = org;
end;
$$;

grant execute on function public.create_org_with_owner to authenticated;
grant execute on function public.join_org_with_invite to authenticated;
grant execute on function public.set_invite_code to authenticated;
grant execute on function public.clear_invite to authenticated;
