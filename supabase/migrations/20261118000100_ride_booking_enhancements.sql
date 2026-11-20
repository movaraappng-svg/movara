-- Extend rider requests with trip details needed for operations and tracking.
grant movara_workflow_owner to postgres with set true, inherit false;
grant create on schema public to movara_workflow_owner;
alter table public.rides
  add column pickup_latitude double precision,
  add column pickup_longitude double precision,
  add column destination_latitude double precision,
  add column destination_longitude double precision,
  add column service_level text not null default 'standard',
  add column scheduled_for timestamptz,
  add column special_instructions text,
  add column payment_method text not null default 'cash',
  add column cancelled_at timestamptz,
  add column cancellation_reason text;

alter table public.rides
  add constraint rides_pickup_coordinates_pair check (
    (pickup_latitude is null) = (pickup_longitude is null)
  ),
  add constraint rides_destination_coordinates_pair check (
    (destination_latitude is null) = (destination_longitude is null)
  ),
  add constraint rides_coordinates_valid check (
    (pickup_latitude is null or pickup_latitude between -90 and 90)
    and (pickup_longitude is null or pickup_longitude between -180 and 180)
    and (destination_latitude is null or destination_latitude between -90 and 90)
    and (destination_longitude is null or destination_longitude between -180 and 180)
  ),
  add constraint rides_service_level_valid check (
    service_level in ('standard', 'comfort', 'keke')
  ),
  add constraint rides_payment_method_valid check (payment_method = 'cash'),
  add constraint rides_instructions_length check (
    special_instructions is null or pg_catalog.length(special_instructions) <= 300
  ),
  add constraint rides_cancellation_reason_length check (
    cancellation_reason is null or pg_catalog.length(cancellation_reason) <= 500
  );

create index rides_scheduled_recent_idx
  on public.rides(scheduled_for)
  where scheduled_for is not null and status = 'requested';

grant insert (
  pickup_latitude, pickup_longitude, destination_latitude, destination_longitude,
  service_level, scheduled_for, special_instructions, payment_method
) on public.rides to authenticated;

-- The non-login workflow owner can only transition a rider's pending request
-- through the guarded cancellation function below.
grant select, update on public.rides to movara_workflow_owner;
create policy workflow_rides on public.rides
  for all to movara_workflow_owner using (true) with check (true);

create function public.cancel_ride(p_ride_id uuid, p_reason text default null)
returns void language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_ride public.rides%rowtype;
  v_reason text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
begin
  if v_user is null then
    raise exception 'Sign in to cancel this ride' using errcode = '42501';
  end if;
  select * into v_ride from public.rides where id = p_ride_id for update;
  if not found or v_ride.customer_id <> v_user then
    raise exception 'Ride not found' using errcode = '42501';
  end if;
  if v_ride.status not in ('requested', 'matching') then
    raise exception 'This ride can no longer be cancelled here' using errcode = '22023';
  end if;
  if v_reason is not null and pg_catalog.length(v_reason) > 500 then
    raise exception 'Cancellation reason is too long' using errcode = '22023';
  end if;
  update public.rides
    set status = 'cancelled', cancelled_at = pg_catalog.now(),
        cancellation_reason = v_reason, updated_at = pg_catalog.now()
    where id = p_ride_id;
end;
$$;

alter function public.cancel_ride(uuid, text) owner to movara_workflow_owner;
revoke all on function public.cancel_ride(uuid, text) from public, anon;
grant execute on function public.cancel_ride(uuid, text) to authenticated;
revoke movara_workflow_owner from postgres;
revoke create on schema public from movara_workflow_owner;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'rides'
  ) then
    alter publication supabase_realtime add table public.rides;
  end if;
end;
$$;
