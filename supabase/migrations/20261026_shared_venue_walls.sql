-- Run in the Supabase SQL Editor before deploying the shared-walls client.
-- Fixed walls and their fixtures are team-owned. Artwork layouts remain in exhibitions.
begin;

alter table public.teams
    add column if not exists venue_walls jsonb,
    add column if not exists venue_walls_revision bigint not null default 0;

grant update (venue_walls, venue_walls_revision) on public.teams to authenticated;

-- Reuse the existing team policies: members read; owners/editors update.
-- The existing is_team_member/current_team_role functions are created by schema.sql.
drop policy if exists "editors can update team venue walls" on public.teams;
create policy "editors can update team venue walls"
    on public.teams for update to authenticated
    using ((select public.current_team_role(id)) in ('owner', 'editor'))
    with check ((select public.current_team_role(id)) in ('owner', 'editor'));

-- Seed once from each team's most recently saved exhibition. Running this
-- migration again never replaces an already-created venue configuration.
with latest as (
    select distinct on (team_id) team_id, data
    from public.exhibitions
    where jsonb_typeof(data -> 'wallPlanJsonData') = 'object'
    order by team_id, updated_at desc, id
), source_walls as (
    select latest.team_id, entry.key as wall_id, entry.value as wall,
        case jsonb_typeof(entry.value -> 'json')
            when 'string' then coalesce(nullif(btrim(entry.value ->> 'json'), ''), '{"objects":[]}')::jsonb
            when 'object' then entry.value -> 'json'
            else jsonb_build_object('objects', '[]'::jsonb)
        end as plan
    from latest
    cross join lateral jsonb_each(latest.data -> 'wallPlanJsonData') as entry
    where coalesce(entry.value ->> 'movableWallId', '') = ''
), blueprints as (
    select source_walls.*,
        (select value from jsonb_array_elements(coalesce(plan -> 'objects', '[]'::jsonb))
            where value ->> 'isWallOutline' = 'true' limit 1) as outline,
        (select coalesce(jsonb_agg(value), '[]'::jsonb)
            from jsonb_array_elements(coalesce(plan -> 'objects', '[]'::jsonb))
            where value ->> 'isWallOutline' = 'true' or value ->> 'isFixture' = 'true') as fixtures
    from source_walls
), grouped as (
    select team_id, jsonb_object_agg(wall_id, jsonb_build_object(
        'title', wall ->> 'title',
        'floorId', coalesce(wall ->> 'floorId', 'lobby'),
        'widthCm', wall -> 'widthCm',
        'heightCm', 450,
        'fixtureScale', coalesce(
            (outline ->> 'height')::double precision * coalesce((outline ->> 'scaleY')::double precision, 1)
                / coalesce(nullif((wall ->> 'legacyHeightCm')::double precision, 0),
                    nullif((wall ->> 'heightCm')::double precision, 0), 450), 0.5),
        'json', jsonb_build_object('version', plan -> 'version', 'objects', fixtures)
    )) as walls
    from blueprints
    group by team_id
)
update public.teams as team
set venue_walls = grouped.walls, venue_walls_revision = team.venue_walls_revision + 1
from grouped
where team.id = grouped.team_id and team.venue_walls is null;

-- Team updates are already used for scale synchronization; enable them here too.
do $$
begin
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
        and not exists (select 1 from pg_publication_tables
            where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'teams') then
        alter publication supabase_realtime add table public.teams;
    end if;
end $$;

commit;
