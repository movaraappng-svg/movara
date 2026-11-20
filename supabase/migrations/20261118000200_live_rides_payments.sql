-- Live route pricing, secure driver dispatch and payment records.
grant movara_workflow_owner to postgres with set true, inherit false;
grant create on schema public to movara_workflow_owner;
create table public.ride_pricing_rules (
  id uuid primary key default gen_random_uuid(),
  service_level text not null unique
    check (service_level in ('standard', 'comfort', 'keke')),
  base_fare_ngn_kobo bigint not null check (base_fare_ngn_kobo > 0),
  per_kilometer_ngn_kobo bigint not null check (per_kilometer_ngn_kobo >= 0),
  per_minute_ngn_kobo bigint not null check (per_minute_ngn_kobo >= 0),
  minimum_fare_ngn_kobo bigint not null check (minimum_fare_ngn_kobo > 0),
  active boolean not null default false,
  updated_at timestamptz not null default now()
);

-- Provisional launch floors copied from the existing UI. Distance and time
-- multipliers remain zero until the approved fare sheet is supplied.
insert into public.ride_pricing_rules
  (service_level, base_fare_ngn_kobo, per_kilometer_ngn_kobo, per_minute_ngn_kobo, minimum_fare_ngn_kobo, active)
values
  ('standard', 350000, 0, 0, 350000, true),
  ('comfort', 500000, 0, 0, 500000, true),
  ('keke', 150000, 0, 0, 150000, true)
on conflict (service_level) do nothing;

alter table public.ride_pricing_rules enable row level security;
revoke all on public.ride_pricing_rules from anon, authenticated;
grant select on public.ride_pricing_rules to authenticated;
grant insert, update, delete on public.ride_pricing_rules to authenticated;
create policy ride_pricing_rules_admin_read on public.ride_pricing_rules
  for select to authenticated using (active or (select private.has_role('administrator')));
create policy ride_pricing_rules_admin_write on public.ride_pricing_rules
  for all to authenticated
  using ((select private.has_role('administrator')))
  with check ((select private.has_role('administrator')));

alter table public.rides drop constraint rides_payment_method_valid;
alter table public.rides add constraint rides_payment_method_valid
  check (payment_method in ('cash', 'paystack'));

alter table public.payments
  add column ride_id uuid references public.rides(id) on delete restrict;
create unique index payments_ride_pending_or_paid_uq
  on public.payments(ride_id)
  where ride_id is not null and status in ('pending', 'succeeded');
create unique index payments_provider_reference_uq
  on public.payments(provider, provider_reference)
  where provider_reference is not null;

create table public.ride_live_locations (
  ride_id uuid primary key references public.rides(id) on delete cascade,
  driver_id uuid not null references public.profiles(id),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  updated_at timestamptz not null default now()
);
alter table public.ride_live_locations enable row level security;
revoke all on public.ride_live_locations from anon, authenticated;
grant select on public.ride_live_locations to authenticated;
grant select, insert, update on public.ride_live_locations to movara_workflow_owner;
create policy ride_live_location_read_parties on public.ride_live_locations
  for select to authenticated using (
    exists (select 1 from public.rides r where r.id = ride_id
      and (r.customer_id = (select auth.uid()) or r.driver_id = (select auth.uid())))
  );
create policy workflow_ride_live_locations on public.ride_live_locations
  for all to movara_workflow_owner using (true) with check (true);

create policy rides_read_for_eligible_drivers on public.rides
  for select to authenticated using (
    driver_id is null
    and status in ('requested', 'matching')
    and (select private.has_role('driver'))
    and exists (select 1 from public.driver_profiles dp
      where dp.driver_id = (select auth.uid()) and dp.is_online)
    and exists (select 1 from public.driver_verifications dv
      where dv.driver_id = (select auth.uid()) and dv.status = 'approved')
    and exists (select 1 from public.vehicles v
      where v.driver_id = (select auth.uid()) and v.verification = 'approved'
        and v.capacity >= passenger_count
        and ((service_level = 'keke' and v.vehicle_type = 'keke')
          or (service_level in ('standard', 'comfort') and v.vehicle_type = 'car')))
  );

grant select, update on public.driver_profiles to movara_workflow_owner;
create policy workflow_driver_profiles on public.driver_profiles
  for all to movara_workflow_owner using (true) with check (true);

create function public.driver_accept_ride(p_ride_id uuid)
returns uuid language plpgsql security definer
set search_path = ''
as $$
declare
  v_driver uuid := auth.uid();
  v_ride public.rides%rowtype;
  v_vehicle uuid;
begin
  if v_driver is null or not (select private.has_role('driver')) then
    raise exception 'Verified driver access required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.driver_profiles dp
      where dp.driver_id = v_driver and dp.is_online)
    or not exists (select 1 from public.driver_verifications dv
      where dv.driver_id = v_driver and dv.status = 'approved') then
    raise exception 'Go online after your driver verification is approved' using errcode = '42501';
  end if;
  select * into v_ride from public.rides where id = p_ride_id for update;
  if not found or v_ride.driver_id is not null
    or v_ride.status not in ('requested', 'matching') then
    raise exception 'This ride is no longer available' using errcode = '22023';
  end if;
  select v.id into v_vehicle from public.vehicles v
    where v.driver_id = v_driver and v.verification = 'approved'
      and v.capacity >= v_ride.passenger_count
      and ((v_ride.service_level = 'keke' and v.vehicle_type = 'keke')
        or (v_ride.service_level in ('standard', 'comfort') and v.vehicle_type = 'car'))
    order by v.created_at limit 1;
  if v_vehicle is null then
    raise exception 'An approved vehicle for this ride is required' using errcode = '42501';
  end if;
  update public.rides set driver_id = v_driver, vehicle_id = v_vehicle,
    status = 'accepted', updated_at = pg_catalog.now() where id = p_ride_id;
  return p_ride_id;
end;
$$;

create function public.driver_update_ride_status(
  p_ride_id uuid, p_new_status public.ride_status
)
returns void language plpgsql security definer
set search_path = ''
as $$
declare
  v_driver uuid := auth.uid();
  v_ride public.rides%rowtype;
begin
  if v_driver is null or not (select private.has_role('driver')) then
    raise exception 'Driver access required' using errcode = '42501';
  end if;
  select * into v_ride from public.rides where id = p_ride_id for update;
  if not found or v_ride.driver_id <> v_driver then
    raise exception 'Ride not found' using errcode = '42501';
  end if;
  if p_new_status = 'in_progress' and v_ride.status = 'accepted' then
    if v_ride.payment_method = 'paystack' and not exists (
      select 1 from public.payments p where p.ride_id = p_ride_id and p.status = 'succeeded'
    ) then
      raise exception 'Confirm the rider payment before starting this trip' using errcode = '22023';
    end if;
  elsif p_new_status = 'completed' and v_ride.status = 'in_progress' then
    null;
  else
    raise exception 'That ride status change is not allowed' using errcode = '22023';
  end if;
  update public.rides set status = p_new_status,
    final_fare_ngn_kobo = case when p_new_status = 'completed'
      then coalesce(final_fare_ngn_kobo, estimated_fare_ngn_kobo)
      else final_fare_ngn_kobo end,
    updated_at = pg_catalog.now() where id = p_ride_id;
end;
$$;

create function public.driver_update_ride_location(
  p_ride_id uuid, p_latitude double precision, p_longitude double precision
)
returns void language plpgsql security definer
set search_path = ''
as $$
declare
  v_driver uuid := auth.uid();
begin
  if v_driver is null or p_latitude not between -90 and 90
    or p_longitude not between -180 and 180 then
    raise exception 'Valid driver location required' using errcode = '22023';
  end if;
  if not exists (select 1 from public.rides r where r.id = p_ride_id
      and r.driver_id = v_driver and r.status in ('accepted', 'in_progress')) then
    raise exception 'Location sharing is only available for your active ride' using errcode = '42501';
  end if;
  insert into public.ride_live_locations(ride_id, driver_id, latitude, longitude, updated_at)
    values (p_ride_id, v_driver, p_latitude, p_longitude, pg_catalog.now())
  on conflict (ride_id) do update set driver_id = excluded.driver_id,
    latitude = excluded.latitude, longitude = excluded.longitude,
    updated_at = excluded.updated_at;
end;
$$;

alter function public.driver_accept_ride(uuid) owner to movara_workflow_owner;
alter function public.driver_update_ride_status(uuid, public.ride_status)
  owner to movara_workflow_owner;
alter function public.driver_update_ride_location(uuid, double precision, double precision)
  owner to movara_workflow_owner;
revoke all on function public.driver_accept_ride(uuid) from public, anon;
revoke all on function public.driver_update_ride_status(uuid, public.ride_status) from public, anon;
revoke all on function public.driver_update_ride_location(uuid, double precision, double precision) from public, anon;
grant execute on function public.driver_accept_ride(uuid) to authenticated;
grant execute on function public.driver_update_ride_status(uuid, public.ride_status) to authenticated;
grant execute on function public.driver_update_ride_location(uuid, double precision, double precision) to authenticated;
revoke movara_workflow_owner from postgres;
revoke create on schema public from movara_workflow_owner;

do $$
begin
  if not exists (select 1 from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'ride_live_locations') then
    alter publication supabase_realtime add table public.ride_live_locations;
  end if;
end;
$$;
