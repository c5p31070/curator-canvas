-- Add authenticated guests while keeping team configuration writes for owners/editors.
begin;

alter table public.team_members
    drop constraint if exists team_members_role_check,
    add constraint team_members_role_check check (role in ('owner', 'editor', 'viewer', 'guest'));

alter policy "editors can create exhibitions" on public.exhibitions
    with check (
        (select public.current_team_role(team_id)) in ('owner', 'editor', 'guest')
        and updated_by = (select auth.uid())
    );

alter policy "editors can update exhibitions" on public.exhibitions
    using ((select public.current_team_role(team_id)) in ('owner', 'editor', 'guest'))
    with check (
        (select public.current_team_role(team_id)) in ('owner', 'editor', 'guest')
        and updated_by = (select auth.uid())
    );

alter policy "editors can delete exhibitions" on public.exhibitions
    using ((select public.current_team_role(team_id)) in ('owner', 'editor', 'guest'));

-- Used by the owner-only invite-member Edge Function for accounts created in advance.
create or replace function public.find_confirmed_invite_user(target_email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
    select id from auth.users
    where lower(email) = lower(target_email) and email_confirmed_at is not null
    limit 1
$$;

revoke all on function public.find_confirmed_invite_user(text) from public, anon, authenticated;
grant execute on function public.find_confirmed_invite_user(text) to service_role;

commit;
