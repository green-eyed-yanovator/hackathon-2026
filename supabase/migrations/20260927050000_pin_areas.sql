-- A pin can cover an area, the way a game marks out a district: a circle of so
-- many metres around it, or a ring of corners drawn round a few blocks.
--
--   {"r": 250}                          a circle, in metres
--   {"ring": [[lng, lat], [lng, lat], …]} three to 32 corners, not closed
--
-- Kept to the pin's own neighbourhood: every corner within about 3 km of it.

create function private.valid_area(area jsonb, lat double precision, lng double precision) returns boolean
language sql immutable
as $$
  select area is null or (
    jsonb_typeof(area) = 'object'
    and (
      (
        area ? 'r' and not area ? 'ring'
        and jsonb_typeof(area -> 'r') = 'number'
        and (area ->> 'r')::double precision between 20 and 2000
      )
      or (
        area ? 'ring' and not area ? 'r'
        and jsonb_typeof(area -> 'ring') = 'array'
        and jsonb_array_length(area -> 'ring') between 3 and 32
        and not exists (
          select 1 from jsonb_array_elements(area -> 'ring') as corner
          where jsonb_typeof(corner) <> 'array'
             or jsonb_array_length(corner) <> 2
             or jsonb_typeof(corner -> 0) <> 'number'
             or jsonb_typeof(corner -> 1) <> 'number'
             or abs((corner ->> 0)::double precision - lng) > 0.04
             or abs((corner ->> 1)::double precision - lat) > 0.03
        )
      )
    )
  )
$$;

alter table public.posts add column area jsonb;
alter table public.posts add constraint posts_area_valid check (private.valid_area(area, latitude, longitude));
grant insert (area), update (area) on public.posts to authenticated;
