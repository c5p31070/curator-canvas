-- Run once in Supabase SQL Editor. Existing exhibition data is preserved.
begin;

alter table public.teams add column if not exists floor_scale double precision;

-- Use the most recently saved valid exhibition scale for each existing team.
update public.teams as t
set floor_scale = coalesce((
    select (e.data->>'scale')::double precision
    from public.exhibitions as e
    where e.team_id = t.id
      and case when jsonb_typeof(e.data->'scale') = 'number'
          then (e.data->>'scale')::numeric > 0 and (e.data->>'scale')::numeric < 1000000
          else false end
    order by e.updated_at desc, e.id
    limit 1
), 0.5)
where t.floor_scale is null;

alter table public.teams alter column floor_scale set default 0.5;
alter table public.teams alter column floor_scale set not null;
alter table public.teams drop constraint if exists teams_floor_scale_check;
alter table public.teams add constraint teams_floor_scale_check
    check (floor_scale > 0 and floor_scale < 1000000);

grant update (floor_scale) on public.teams to authenticated;
drop policy if exists "editors can update team scale" on public.teams;
create policy "editors can update team scale"
    on public.teams for update to authenticated
    using ((select public.current_team_role(id)) in ('owner', 'editor'))
    with check ((select public.current_team_role(id)) in ('owner', 'editor'));

-- Receive scale changes on other open devices without polling.
do $$
begin
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
       and not exists (
           select 1 from pg_publication_tables
           where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'teams'
       ) then
        alter publication supabase_realtime add table public.teams;
    end if;
end $$;

commit;
