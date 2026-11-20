-- Configurable fares and per-city pricing for the four MoVara ride classes.
grant movara_workflow_owner to postgres with set true, inherit false;
grant create on schema public to movara_workflow_owner;
alter table public.ride_pricing_rules
  add column city_code text not null default 'NG-DEFAULT',
  add column booking_fee_ngn_kobo bigint not null default 0 check (booking_fee_ngn_kobo >= 0),
  add column cancellation_fee_ngn_kobo bigint not null default 0 check (cancellation_fee_ngn_kobo >= 0),
  add column commission_basis_points integer not null default 1000 check (commission_basis_points between 0 and 5000);

alter table public.ride_pricing_rules drop constraint if exists ride_pricing_rules_service_level_key;
alter table public.ride_pricing_rules drop constraint if exists ride_pricing_rules_service_level_check;
update public.ride_pricing_rules set service_level = 'economy' where service_level = 'standard';
alter table public.ride_pricing_rules add constraint ride_pricing_rules_service_level_check
  check (service_level in ('economy', 'comfort', 'xl', 'executive', 'keke'));
alter table public.ride_pricing_rules add constraint ride_pricing_rules_city_service_unique unique (city_code, service_level);
grant select on public.ride_pricing_rules to movara_workflow_owner;
create policy workflow_ride_pricing_rules_read on public.ride_pricing_rules
  for select to movara_workflow_owner using (true);

update public.ride_pricing_rules set active = false where service_level = 'keke';
update public.ride_pricing_rules set
  base_fare_ngn_kobo = 50000, booking_fee_ngn_kobo = 50000,
  per_kilometer_ngn_kobo = 13000, per_minute_ngn_kobo = 2500,
  minimum_fare_ngn_kobo = 120000, cancellation_fee_ngn_kobo = 50000,
  commission_basis_points = 1000, active = true
where service_level = 'economy' and city_code = 'NG-DEFAULT';
update public.ride_pricing_rules set
  base_fare_ngn_kobo = 70000, booking_fee_ngn_kobo = 70000,
  per_kilometer_ngn_kobo = 17000, per_minute_ngn_kobo = 3000,
  minimum_fare_ngn_kobo = 200000, cancellation_fee_ngn_kobo = 70000,
  commission_basis_points = 1200, active = true
where service_level = 'comfort' and city_code = 'NG-DEFAULT';

insert into public.ride_pricing_rules
  (city_code, service_level, base_fare_ngn_kobo, booking_fee_ngn_kobo, per_kilometer_ngn_kobo,
   per_minute_ngn_kobo, minimum_fare_ngn_kobo, cancellation_fee_ngn_kobo, commission_basis_points, active)
values
  ('NG-DEFAULT', 'economy', 50000, 50000, 13000, 2500, 120000, 50000, 1000, true),
  ('NG-DEFAULT', 'comfort', 70000, 70000, 17000, 3000, 200000, 70000, 1200, true),
  ('NG-DEFAULT', 'xl', 100000, 100000, 22000, 3500, 300000, 100000, 1500, true),
  ('NG-DEFAULT', 'executive', 150000, 150000, 30000, 4000, 500000, 150000, 1500, true)
on conflict (city_code, service_level) do update set
  base_fare_ngn_kobo = excluded.base_fare_ngn_kobo,
  booking_fee_ngn_kobo = excluded.booking_fee_ngn_kobo,
  per_kilometer_ngn_kobo = excluded.per_kilometer_ngn_kobo,
  per_minute_ngn_kobo = excluded.per_minute_ngn_kobo,
  minimum_fare_ngn_kobo = excluded.minimum_fare_ngn_kobo,
  cancellation_fee_ngn_kobo = excluded.cancellation_fee_ngn_kobo,
  commission_basis_points = excluded.commission_basis_points,
  active = true;

create table public.ride_cities (
  city_code text primary key check (city_code ~ '^[A-Z0-9-]{2,24}$'),
  city_name text not null check (length(btrim(city_name)) between 2 and 100),
  country_code char(2) not null default 'NG' check (country_code = 'NG'),
  country_name text not null default 'Nigeria',
  currency char(3) not null default 'NGN' check (currency = 'NGN'),
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into public.ride_cities(city_code, city_name) values ('NG-DEFAULT', 'Nigeria') on conflict do nothing;
alter table public.ride_cities enable row level security;
revoke all on public.ride_cities from anon, authenticated;
grant select, insert, update, delete on public.ride_cities to authenticated;
create policy ride_cities_public_active on public.ride_cities for select to authenticated using (active or (select private.has_role('administrator')));
create policy ride_cities_admin_write on public.ride_cities for all to authenticated
  using ((select private.has_role('administrator'))) with check ((select private.has_role('administrator')));

alter table public.driver_profiles add column city_code text not null default 'NG-DEFAULT'
  references public.ride_cities(city_code);
grant update (city_code) on public.driver_profiles to authenticated;

create table public.ride_surge_settings (
  city_code text primary key references public.ride_cities(city_code) on delete cascade,
  enabled boolean not null default true,
  automatic_demand boolean not null default true,
  min_multiplier numeric(3,2) not null default 1.00 check (min_multiplier between 1 and 3),
  max_multiplier numeric(3,2) not null default 3.00 check (max_multiplier between 1 and 3),
  demand_per_driver_threshold numeric(5,2) not null default 2.00 check (demand_per_driver_threshold > 0),
  trigger_multipliers jsonb not null default '{"rain":1.0,"holiday":1.0,"event":1.0,"airport":1.0}'::jsonb,
  updated_at timestamptz not null default now(),
  check (min_multiplier <= max_multiplier)
);
insert into public.ride_surge_settings(city_code) values ('NG-DEFAULT') on conflict do nothing;
alter table public.ride_surge_settings enable row level security;
revoke all on public.ride_surge_settings from anon, authenticated;
grant select, insert, update, delete on public.ride_surge_settings to authenticated;
create policy ride_surge_read_active on public.ride_surge_settings for select to authenticated
  using (enabled or (select private.has_role('administrator')));
create policy ride_surge_admin_write on public.ride_surge_settings for all to authenticated
  using ((select private.has_role('administrator'))) with check ((select private.has_role('administrator')));

create table public.ride_pricing_adjustments (
  id uuid primary key default gen_random_uuid(),
  city_code text not null references public.ride_cities(city_code) on delete cascade,
  adjustment_type text not null check (adjustment_type in ('zone', 'airport', 'event', 'corporate', 'promo', 'incentive')),
  name text not null check (length(btrim(name)) between 2 and 120),
  code text,
  boundary jsonb,
  amount_ngn_kobo bigint not null default 0 check (amount_ngn_kobo >= 0),
  multiplier numeric(3,2) not null default 1.00 check (multiplier between 0 and 3),
  discount_basis_points integer not null default 0 check (discount_basis_points between 0 and 10000),
  starts_at timestamptz,
  ends_at timestamptz,
  active boolean not null default false,
  configuration jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);
create unique index ride_pricing_adjustment_code_unique on public.ride_pricing_adjustments(city_code, adjustment_type, lower(code)) where code is not null;
create index ride_pricing_adjustments_active_city on public.ride_pricing_adjustments(city_code, adjustment_type, active, starts_at, ends_at);
alter table public.ride_pricing_adjustments enable row level security;
revoke all on public.ride_pricing_adjustments from anon, authenticated;
grant select, insert, update, delete on public.ride_pricing_adjustments to authenticated;
create policy ride_pricing_adjustment_read_active on public.ride_pricing_adjustments for select to authenticated
  using (active or (select private.has_role('administrator')));
create policy ride_pricing_adjustment_admin_write on public.ride_pricing_adjustments for all to authenticated
  using ((select private.has_role('administrator'))) with check ((select private.has_role('administrator')));
grant select on public.ride_pricing_adjustments to movara_workflow_owner;
create policy workflow_ride_pricing_adjustments_read on public.ride_pricing_adjustments
  for select to movara_workflow_owner using (true);

set role movara_workflow_owner;
create or replace function public.driver_accept_ride(p_ride_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_driver uuid := auth.uid();
  v_ride public.rides%rowtype;
  v_vehicle uuid;
begin
  if v_driver is null or not (select private.has_role('driver')) then raise exception 'Verified driver access required' using errcode = '42501'; end if;
  select * into v_ride from public.rides where id = p_ride_id for update;
  if not found or v_ride.driver_id is not null or v_ride.status not in ('requested', 'matching') then
    raise exception 'This ride is no longer available' using errcode = '22023';
  end if;
  if not exists (select 1 from public.driver_profiles dp where dp.driver_id = v_driver and dp.is_online and dp.city_code = v_ride.city_code)
    or not exists (select 1 from public.driver_verifications dv where dv.driver_id = v_driver and dv.status = 'approved') then
    raise exception 'Go online in this market after your driver verification is approved' using errcode = '42501';
  end if;
  select v.id into v_vehicle from public.vehicles v where v.driver_id = v_driver
    and v.verification = 'approved' and v.capacity >= v_ride.passenger_count and v.vehicle_type = 'car'
    and v_ride.service_level in ('economy', 'comfort', 'xl', 'executive')
  order by v.created_at limit 1;
  if v_vehicle is null then raise exception 'An approved matching vehicle is required' using errcode = '42501'; end if;
  update public.rides set driver_id = v_driver, vehicle_id = v_vehicle, status = 'accepted', updated_at = pg_catalog.now() where id = p_ride_id;
  return p_ride_id;
end;
$$;
revoke all on function public.driver_accept_ride(uuid) from public, anon;
grant execute on function public.driver_accept_ride(uuid) to authenticated;
reset role;

alter table public.rides
  add column city_code text not null default 'NG-DEFAULT' references public.ride_cities(city_code),
  add column surge_multiplier numeric(3,2) not null default 1.00 check (surge_multiplier between 1 and 3),
  add column airport_surcharge_ngn_kobo bigint not null default 0 check (airport_surcharge_ngn_kobo >= 0),
  add column promotion_discount_ngn_kobo bigint not null default 0 check (promotion_discount_ngn_kobo >= 0),
  add column promo_code text,
  add column corporate_code text,
  add column cancellation_fee_ngn_kobo bigint not null default 0 check (cancellation_fee_ngn_kobo >= 0),
  add column driver_commission_ngn_kobo bigint check (driver_commission_ngn_kobo >= 0),
  add column driver_incentive_ngn_kobo bigint not null default 0 check (driver_incentive_ngn_kobo >= 0),
  add column driver_earnings_ngn_kobo bigint check (driver_earnings_ngn_kobo >= 0);

drop policy if exists rides_read_for_eligible_drivers on public.rides;
create policy rides_read_for_eligible_drivers on public.rides for select to authenticated using (
  driver_id is null and status in ('requested', 'matching') and (select private.has_role('driver'))
  and exists (select 1 from public.driver_profiles dp where dp.driver_id = (select auth.uid()) and dp.is_online and dp.city_code = rides.city_code)
  and exists (select 1 from public.driver_verifications dv where dv.driver_id = (select auth.uid()) and dv.status = 'approved')
  and exists (select 1 from public.vehicles v where v.driver_id = (select auth.uid()) and v.verification = 'approved'
    and v.capacity >= passenger_count and v.vehicle_type = 'car'
    and service_level in ('economy', 'comfort', 'xl', 'executive'))
);

alter table public.rides drop constraint if exists rides_currency_check;
alter table public.rides add constraint rides_currency_check check (currency ~ '^[A-Z]{3}$');
alter table public.payments drop constraint if exists payments_currency_check;
alter table public.payments add constraint payments_currency_check check (currency ~ '^[A-Z]{3}$');
alter table public.payments add column payment_type text not null default 'ride'
  check (payment_type in ('ride', 'cancellation_fee'));
drop index if exists public.payments_ride_pending_or_paid_uq;
create unique index payments_ride_type_pending_or_paid_uq
  on public.payments(ride_id, payment_type)
  where ride_id is not null and status in ('pending', 'succeeded');

-- Cancellation may be requested after a driver accepts. The fee is recorded for transparent settlement.
set role movara_workflow_owner;
create or replace function public.cancel_ride(p_ride_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_ride public.rides%rowtype;
  v_reason text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
  v_fee bigint := 0;
begin
  if v_user is null then raise exception 'Sign in to cancel this ride' using errcode = '42501'; end if;
  select * into v_ride from public.rides where id = p_ride_id for update;
  if not found or v_ride.customer_id <> v_user then raise exception 'Ride not found' using errcode = '42501'; end if;
  if v_ride.status not in ('requested', 'matching', 'accepted') then raise exception 'This ride can no longer be cancelled here' using errcode = '22023'; end if;
  if v_reason is not null and pg_catalog.length(v_reason) > 500 then raise exception 'Cancellation reason is too long' using errcode = '22023'; end if;
  if v_ride.status = 'accepted' then
    select cancellation_fee_ngn_kobo into v_fee from public.ride_pricing_rules
      where city_code = v_ride.city_code and service_level = v_ride.service_level and active limit 1;
    v_fee := coalesce(v_fee, 0);
  end if;
  update public.rides set status = 'cancelled', cancelled_at = pg_catalog.now(),
    cancellation_reason = v_reason, cancellation_fee_ngn_kobo = v_fee, updated_at = pg_catalog.now()
    where id = p_ride_id;
end;
$$;
revoke all on function public.cancel_ride(uuid, text) from public, anon;
grant execute on function public.cancel_ride(uuid, text) to authenticated;
reset role;

set role movara_workflow_owner;
create or replace function public.driver_update_ride_status(p_ride_id uuid, p_new_status public.ride_status)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_driver uuid := auth.uid();
  v_ride public.rides%rowtype;
  v_rule public.ride_pricing_rules%rowtype;
  v_commission bigint;
  v_incentive bigint;
begin
  if v_driver is null or not (select private.has_role('driver')) then raise exception 'Driver access required' using errcode = '42501'; end if;
  select * into v_ride from public.rides where id = p_ride_id for update;
  if not found or v_ride.driver_id <> v_driver then raise exception 'Ride not found' using errcode = '42501'; end if;
  if p_new_status = 'in_progress' and v_ride.status = 'accepted' then
    if v_ride.payment_method = 'paystack' and not exists (select 1 from public.payments p where p.ride_id = p_ride_id and p.payment_type = 'ride' and p.status = 'succeeded') then
      raise exception 'Confirm the rider payment before starting this trip' using errcode = '22023';
    end if;
    update public.rides set status = p_new_status, updated_at = pg_catalog.now() where id = p_ride_id;
  elsif p_new_status = 'completed' and v_ride.status = 'in_progress' then
    select * into v_rule from public.ride_pricing_rules where city_code = v_ride.city_code and service_level = v_ride.service_level and active limit 1;
    v_commission := pg_catalog.round(coalesce(v_ride.final_fare_ngn_kobo, v_ride.estimated_fare_ngn_kobo) * coalesce(v_rule.commission_basis_points, 1000) / 10000.0);
    select coalesce(sum(a.amount_ngn_kobo), 0) into v_incentive from public.ride_pricing_adjustments a
      where a.city_code = v_ride.city_code and a.adjustment_type = 'incentive' and a.active
        and (a.starts_at is null or a.starts_at <= pg_catalog.now())
        and (a.ends_at is null or a.ends_at > pg_catalog.now())
        and (a.configuration ->> 'service_level' is null or a.configuration ->> 'service_level' = v_ride.service_level);
    update public.rides set status = p_new_status,
      final_fare_ngn_kobo = coalesce(final_fare_ngn_kobo, estimated_fare_ngn_kobo),
      driver_commission_ngn_kobo = v_commission,
      driver_incentive_ngn_kobo = v_incentive,
      driver_earnings_ngn_kobo = greatest(0, coalesce(final_fare_ngn_kobo, estimated_fare_ngn_kobo) - v_commission) + v_incentive,
      updated_at = pg_catalog.now() where id = p_ride_id;
  else raise exception 'That ride status change is not allowed' using errcode = '22023'; end if;
end;
$$;
revoke all on function public.driver_update_ride_status(uuid, public.ride_status) from public, anon;
grant execute on function public.driver_update_ride_status(uuid, public.ride_status) to authenticated;
reset role;
revoke movara_workflow_owner from postgres;
revoke create on schema public from movara_workflow_owner;
