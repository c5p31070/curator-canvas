-- Requires the existing team scale permissions and RLS policy.
-- NULL means the public exhibition venue has not been calibrated.
begin;

alter table public.teams
    add column if not exists public_floor_scale double precision
    check (public_floor_scale > 0 and public_floor_scale < 1000000);

grant update (public_floor_scale) on public.teams to authenticated;

commit;
