-- Durable dispatch offer records and scheduled ride activation. Local only.
grant movara_workflow_owner to postgres with set true, inherit false;
grant create on schema public to movara_workflow_owner;
alter table public.ride_requests
  add column if not exists expires_at timestamptz,
  add column if not exists offer_round integer not null default 1 check (offer_round > 0);

alter table public.rides
  add column if not exists dispatch_started_at timestamptz,
  add column if not exists dispatch_round integer not null default 0 check (dispatch_round >= 0),
  add column if not exists dispatch_excluded_drivers uuid[] not null default '{}';

create index if not exists ride_requests_pending_offer_idx
  on public.ride_requests(status, expires_at, ride_id) where status = 'offered';
create index if not exists rides_dispatch_queue_idx
  on public.rides(city_code, scheduled_for, created_at)
  where driver_id is null and status in ('requested','matching');

grant select, insert, update on public.ride_requests to movara_workflow_owner;
grant update on public.rides to movara_workflow_owner;
grant select on public.driver_profiles, public.driver_verifications, public.vehicles to movara_workflow_owner;
create policy workflow_ride_requests on public.ride_requests
  for all to movara_workflow_owner using (true) with check (true);

drop policy if exists rides_read_for_eligible_drivers on public.rides;
create policy rides_read_for_eligible_drivers on public.rides for select to authenticated using (
  driver_id is null and status in ('requested','matching') and (select private.has_role('driver'))
  and exists(select 1 from public.ride_requests rr where rr.ride_id=rides.id
    and rr.driver_id=(select auth.uid()) and rr.status='offered' and rr.expires_at>pg_catalog.now())
);

set role movara_workflow_owner;

create or replace function public.driver_poll_ride_offers()
returns setof public.rides language plpgsql security definer set search_path = '' as $$
declare
  v_driver uuid := auth.uid();
  v_city text;
  v_now timestamptz := pg_catalog.now();
  v_ride public.rides%rowtype;
  v_vehicle uuid;
  v_offer_id uuid;
begin
  if v_driver is null or not (select private.has_role('driver')) then
    raise exception 'Driver access required' using errcode = '42501';
  end if;
  select city_code into v_city from public.driver_profiles
    where driver_id = v_driver and is_online;
  if v_city is null or not exists(select 1 from public.driver_verifications dv
      where dv.driver_id = v_driver and dv.status = 'approved') then
    return;
  end if;

  -- Expire this driver's unattended offers and exclude expired candidates from the next round.
  update public.ride_requests set status = 'expired', responded_at = v_now
    where driver_id = v_driver and status = 'offered' and expires_at <= v_now;
  update public.rides r set dispatch_excluded_drivers = array_append(r.dispatch_excluded_drivers, v_driver)
    where r.id in (select rr.ride_id from public.ride_requests rr
      where rr.driver_id = v_driver and rr.status = 'expired')
      and not (v_driver = any(r.dispatch_excluded_drivers));

  -- Return still-live offers first.
  return query select r.* from public.ride_requests rr join public.rides r on r.id = rr.ride_id
    where rr.driver_id = v_driver and rr.status = 'offered' and rr.expires_at > v_now
      and r.driver_id is null and r.status in ('requested','matching')
    order by rr.created_at;

  if found then return; end if;

  -- Open at most one offer per poll; DB row locking prevents drivers racing the same wave.
  for v_ride in
    select r.* from public.rides r
    where r.driver_id is null and r.city_code = v_city and r.status in ('requested','matching')
      and coalesce(r.scheduled_for, r.created_at) <= v_now + interval '10 minutes'
      and (r.scheduled_for is null or r.scheduled_for <= v_now + interval '10 minutes')
      and not (v_driver = any(r.dispatch_excluded_drivers))
      and not exists(select 1 from public.ride_requests rr where rr.ride_id=r.id and rr.driver_id=v_driver)
      and exists(select 1 from public.vehicles v where v.driver_id=v_driver and v.verification='approved'
        and v.capacity >= r.passenger_count and v.vehicle_type='car')
    order by r.scheduled_for nulls first, r.created_at
    for update skip locked limit 1
  loop
    insert into public.ride_requests(ride_id,driver_id,status,expires_at,offer_round)
      values(v_ride.id,v_driver,'offered',v_now + interval '25 seconds',greatest(1,v_ride.dispatch_round + 1))
      on conflict(ride_id,driver_id) do nothing returning id into v_offer_id;
    if v_offer_id is not null then
      update public.rides set status='matching', dispatch_started_at=coalesce(dispatch_started_at,v_now),
        dispatch_round=greatest(dispatch_round,1), updated_at=v_now where id=v_ride.id;
      return query select r.* from public.rides r where r.id=v_ride.id;
      return;
    end if;
  end loop;
end;
$$;

create or replace function public.driver_accept_ride(p_ride_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_driver uuid := auth.uid();
  v_ride public.rides%rowtype;
  v_vehicle uuid;
  v_offer public.ride_requests%rowtype;
begin
  if v_driver is null or not (select private.has_role('driver')) then
    raise exception 'Verified driver access required' using errcode = '42501';
  end if;
  select * into v_ride from public.rides where id=p_ride_id for update;
  if not found or v_ride.driver_id is not null or v_ride.status not in ('requested','matching') then
    raise exception 'This ride is no longer available' using errcode = '22023';
  end if;
  select * into v_offer from public.ride_requests where ride_id=p_ride_id and driver_id=v_driver for update;
  if not found or v_offer.status <> 'offered' or v_offer.expires_at <= pg_catalog.now() then
    raise exception 'This offer has expired. Refresh for another ride.' using errcode = '22023';
  end if;
  if not exists(select 1 from public.driver_profiles dp where dp.driver_id=v_driver and dp.is_online and dp.city_code=v_ride.city_code)
    or not exists(select 1 from public.driver_verifications dv where dv.driver_id=v_driver and dv.status='approved') then
    raise exception 'Go online in this market after driver verification is approved' using errcode = '42501';
  end if;
  select v.id into v_vehicle from public.vehicles v where v.driver_id=v_driver and v.verification='approved'
    and v.capacity>=v_ride.passenger_count and v.vehicle_type='car'
    and v_ride.service_level in ('economy','comfort','xl','executive') order by v.created_at limit 1;
  if v_vehicle is null then raise exception 'An approved matching vehicle is required' using errcode = '42501'; end if;

  update public.ride_requests set status='accepted',responded_at=pg_catalog.now()
    where ride_id=p_ride_id and driver_id=v_driver;
  update public.ride_requests set status='withdrawn',responded_at=pg_catalog.now()
    where ride_id=p_ride_id and driver_id<>v_driver and status='offered';
  update public.rides set driver_id=v_driver,vehicle_id=v_vehicle,status='accepted',updated_at=pg_catalog.now()
    where id=p_ride_id;
  return p_ride_id;
end;
$$;

create or replace function public.driver_decline_ride_offer(p_ride_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_driver uuid:=auth.uid();
begin
  if v_driver is null or not (select private.has_role('driver')) then
    raise exception 'Driver access required' using errcode='42501';
  end if;
  update public.ride_requests set status='rejected',responded_at=pg_catalog.now()
    where ride_id=p_ride_id and driver_id=v_driver and status='offered';
  if not found then raise exception 'No active offer exists for this ride' using errcode='22023'; end if;
  update public.rides set dispatch_excluded_drivers=array_append(dispatch_excluded_drivers,v_driver),
    updated_at=pg_catalog.now() where id=p_ride_id and not (v_driver=any(dispatch_excluded_drivers));
end;
$$;

create or replace function public.admin_reassign_ride(p_ride_id uuid,p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid(); v_ride public.rides%rowtype;
begin
  if v_actor is null or not (select private.has_role('administrator')) then
    raise exception 'Administrator access required' using errcode='42501';
  end if;
  if length(pg_catalog.btrim(coalesce(p_reason,''))) not between 5 and 500 then
    raise exception 'Provide a reassignment reason' using errcode='22023';
  end if;
  select * into v_ride from public.rides where id=p_ride_id for update;
  if not found or v_ride.status not in ('accepted','matching') then
    raise exception 'Only a matching or accepted ride can be reassigned' using errcode='22023';
  end if;
  if v_ride.status='accepted' then
    update public.rides set dispatch_excluded_drivers=array_append(dispatch_excluded_drivers,v_ride.driver_id),
      driver_id=null,vehicle_id=null,status='matching',driver_arrived_at=null,updated_at=pg_catalog.now()
      where id=p_ride_id and v_ride.driver_id is not null;
  end if;
  update public.ride_requests set status='withdrawn',responded_at=pg_catalog.now()
    where ride_id=p_ride_id and status in ('offered','accepted');
  perform private.write_audit(v_actor,'ride_reassigned','ride',p_ride_id,
    pg_catalog.jsonb_build_object('reason',pg_catalog.btrim(p_reason),'previous_driver_id',v_ride.driver_id));
end;
$$;

alter function public.driver_poll_ride_offers() owner to movara_workflow_owner;
alter function public.driver_accept_ride(uuid) owner to movara_workflow_owner;
alter function public.driver_decline_ride_offer(uuid) owner to movara_workflow_owner;
alter function public.admin_reassign_ride(uuid,text) owner to movara_workflow_owner;
revoke all on function public.driver_poll_ride_offers(),public.driver_accept_ride(uuid),
  public.driver_decline_ride_offer(uuid),public.admin_reassign_ride(uuid,text) from public,anon;
grant execute on function public.driver_poll_ride_offers(),public.driver_accept_ride(uuid),
  public.driver_decline_ride_offer(uuid) to authenticated;
grant execute on function public.admin_reassign_ride(uuid,text) to authenticated;

reset role;
revoke create on schema public from movara_workflow_owner;
revoke movara_workflow_owner from postgres;
