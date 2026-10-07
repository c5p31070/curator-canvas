-- Run this in Supabase SQL Editor after creating the initial administrator user.
-- Replace the email and team name in the final block before running it.

create table if not exists public.teams (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    created_by uuid not null references auth.users(id) on delete restrict,
    created_at timestamptz not null default now()
);

create table if not exists public.team_members (
    team_id uuid not null references public.teams(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    role text not null check (role in ('owner', 'editor', 'viewer')),
    created_at timestamptz not null default now(),
    primary key (team_id, user_id)
);

create index if not exists team_members_user_id_idx on public.team_members(user_id);

create table if not exists public.exhibitions (
    id uuid primary key default gen_random_uuid(),
    team_id uuid not null references public.teams(id) on delete cascade,
    title text not null,
    data jsonb not null,
    updated_by uuid references auth.users(id) on delete set null,
    updated_at timestamptz not null default now()
);

create index if not exists exhibitions_team_updated_idx
    on public.exhibitions(team_id, updated_at desc);

create or replace function public.current_team_role(target_team_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
    select m.role
    from public.team_members as m
    where m.team_id = target_team_id and m.user_id = (select auth.uid())
    limit 1
$$;

create or replace function public.is_team_member(target_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1 from public.team_members as m
        where m.team_id = target_team_id and m.user_id = (select auth.uid())
    )
$$;

revoke all on function public.current_team_role(uuid) from public;
revoke all on function public.is_team_member(uuid) from public;
grant execute on function public.current_team_role(uuid) to authenticated;
grant execute on function public.is_team_member(uuid) to authenticated;

alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.exhibitions enable row level security;

revoke all on public.teams, public.team_members, public.exhibitions from anon, authenticated;
grant select on public.teams, public.team_members to authenticated;
grant select, insert, update, delete on public.exhibitions to authenticated;

drop policy if exists "team members can view their team" on public.teams;
create policy "team members can view their team"
    on public.teams for select to authenticated
    using ((select public.is_team_member(id)));

drop policy if exists "team members can view membership" on public.team_members;
create policy "team members can view membership"
    on public.team_members for select to authenticated
    using ((select public.is_team_member(team_id)));

drop policy if exists "team members can view exhibitions" on public.exhibitions;
create policy "team members can view exhibitions"
    on public.exhibitions for select to authenticated
    using ((select public.is_team_member(team_id)));

drop policy if exists "editors can create exhibitions" on public.exhibitions;
create policy "editors can create exhibitions"
    on public.exhibitions for insert to authenticated
    with check (
        (select public.current_team_role(team_id)) in ('owner', 'editor')
        and updated_by = (select auth.uid())
    );

drop policy if exists "editors can update exhibitions" on public.exhibitions;
create policy "editors can update exhibitions"
    on public.exhibitions for update to authenticated
    using ((select public.current_team_role(team_id)) in ('owner', 'editor'))
    with check (
        (select public.current_team_role(team_id)) in ('owner', 'editor')
        and updated_by = (select auth.uid())
    );

drop policy if exists "editors can delete exhibitions" on public.exhibitions;
create policy "editors can delete exhibitions"
    on public.exhibitions for delete to authenticated
    using ((select public.current_team_role(team_id)) in ('owner', 'editor'));

-- Bootstrap the first administrator after creating their invited user in Authentication > Users.
-- Replace the email and team name, then run this block once.
do $$
declare
    admin_email text := 'REPLACE_WITH_ADMIN_EMAIL';
    team_name text := '東京都美術館 展覧会チーム';
    admin_id uuid;
    new_team_id uuid;
begin
    select id into admin_id from auth.users where lower(email) = lower(admin_email) limit 1;
    if admin_id is null then
        raise exception 'Admin user not found. Create the invited user in Supabase Auth first.';
    end if;
    insert into public.teams(name, created_by) values (team_name, admin_id)
    returning id into new_team_id;
    insert into public.team_members(team_id, user_id, role)
    values (new_team_id, admin_id, 'owner');
end $$;
