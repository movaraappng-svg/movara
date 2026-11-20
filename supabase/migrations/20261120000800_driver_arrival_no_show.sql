-- Driver arrival and rider no-show lifecycle. Migration remains local until reviewed.
alter table public.rides
  add column if not exists driver_arrived_at timestamptz,
  add column if not exists rider_no_show_at timestamptz;

grant select on public.ride_requests to authenticated;

grant movara_workflow_owner to postgres with set true, inherit false;
grant create on schema public, private to movara_workflow_owner;
grant update on public.rides to movara_workflow_owner;
grant trigger on public.rides to movara_workflow_owner;
set role movara_workflow_owner;

create or replace function public.driver_mark_arrived(p_ride_id uuid)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  v_driver uuid := auth.uid();
  v_ride public.rides%rowtype;
  v_arrived_at timestamptz;
begin
  if v_driver is null or not (select private.has_role('driver')) then
    raise exception 'Driver access required' using errcode = '42501';
  end if;

  select * into v_ride from public.rides where id = p_ride_id for update;
  if not found or v_ride.driver_id <> v_driver then
    raise exception 'Ride not found' using errcode = '42501';
  end if;
  if v_ride.status <> 'accepted' then
    raise exception 'Arrival can only be recorded before the trip starts' using errcode = '22023';
  end if;

  v_arrived_at := coalesce(v_ride.driver_arrived_at, pg_catalog.now());
  update public.rides set driver_arrived_at = v_arrived_at, updated_at = pg_catalog.now()
    where id = p_ride_id;
  return v_arrived_at;
end;
$$;

create or replace function public.driver_report_rider_no_show(p_ride_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
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
  if v_ride.status <> 'accepted' or v_ride.driver_arrived_at is null then
    raise exception 'Record your arrival before reporting a rider no-show' using errcode = '22023';
  end if;
  if v_ride.driver_arrived_at > pg_catalog.now() - interval '5 minutes' then
    raise exception 'Wait at least five minutes after arrival before reporting a no-show' using errcode = '22023';
  end if;

  update public.rides set status = 'cancelled',
    cancellation_reason = 'rider_no_show',
    cancellation_fee_ngn_kobo = 0,
    rider_no_show_at = pg_catalog.now(),
    cancelled_at = pg_catalog.now(),
    updated_at = pg_catalog.now()
    where id = p_ride_id;
end;
$$;

create or replace function private.guard_ride_start_requires_arrival()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status = 'in_progress' and old.status = 'accepted' and new.driver_arrived_at is null then
    raise exception 'Record your arrival before starting this trip' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger ride_start_requires_driver_arrival
before update of status on public.rides
for each row execute function private.guard_ride_start_requires_arrival();

create or replace function private.notify_driver_arrival()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.driver_arrived_at is not null or new.driver_arrived_at is null then return new; end if;
  if exists(select 1 from public.notification_preferences n where n.user_id=new.customer_id
    and n.kind in ('all','driver_arrived') and n.channel='in_app' and not n.enabled) then return new; end if;
  insert into public.notifications(user_id,kind,payload,event_key)
    values(new.customer_id,'driver_arrived',
      pg_catalog.jsonb_build_object('ride_id',new.id,'pickup',new.pickup_label,'arrived_at',new.driver_arrived_at),
      'ride:'||new.id::text||':driver-arrived:customer') on conflict do nothing;
  return new;
end;
$$;

alter function public.driver_mark_arrived(uuid) owner to movara_workflow_owner;
alter function public.driver_report_rider_no_show(uuid) owner to movara_workflow_owner;
alter function private.guard_ride_start_requires_arrival() owner to movara_workflow_owner;
alter function private.notify_driver_arrival() owner to movara_workflow_owner;
revoke all on function public.driver_mark_arrived(uuid) from public, anon;
revoke all on function public.driver_report_rider_no_show(uuid) from public, anon;
grant execute on function public.driver_mark_arrived(uuid) to authenticated;
grant execute on function public.driver_report_rider_no_show(uuid) to authenticated;
revoke all on function private.guard_ride_start_requires_arrival(),private.notify_driver_arrival() from public, anon, authenticated;
grant execute on function private.guard_ride_start_requires_arrival(),private.notify_driver_arrival() to movara_workflow_owner;

create trigger notification_driver_arrival after update of driver_arrived_at on public.rides
for each row execute function private.notify_driver_arrival();

reset role;
revoke create on schema public from movara_workflow_owner;
revoke create on schema private from movara_workflow_owner;
revoke trigger on public.rides from movara_workflow_owner;
revoke movara_workflow_owner from postgres;

