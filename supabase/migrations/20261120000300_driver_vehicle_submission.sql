-- Let an approved driver submit a vehicle for the existing admin review flow.
grant movara_workflow_owner to postgres with set true, inherit false;
grant create on schema public to movara_workflow_owner;
set role movara_workflow_owner;

create function public.submit_driver_vehicle(
  p_vehicle_type text,
  p_make text,
  p_model text,
  p_registration_number text,
  p_capacity integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_driver uuid := auth.uid();
  v_vehicle uuid;
begin
  if v_driver is null
    or not exists (
      select 1 from public.user_roles r
      where r.user_id = v_driver and r.role = 'driver'
    )
    or not exists (
      select 1 from public.driver_verifications d
      where d.driver_id = v_driver and d.status = 'approved'
    ) then
    raise exception 'Approved driver identity is required before adding a vehicle'
      using errcode = '42501';
  end if;

  if p_vehicle_type not in ('car', 'keke')
    or length(pg_catalog.btrim(coalesce(p_make, ''))) not between 1 and 80
    or length(pg_catalog.btrim(coalesce(p_model, ''))) not between 1 and 80
    or length(pg_catalog.btrim(coalesce(p_registration_number, ''))) not between 3 and 32
    or p_capacity not between 1 and 20 then
    raise exception 'Vehicle details are incomplete or invalid'
      using errcode = '22023';
  end if;

  insert into public.vehicles(
    driver_id, vehicle_type, make, model, registration_number, capacity
  ) values (
    v_driver, p_vehicle_type, pg_catalog.btrim(p_make), pg_catalog.btrim(p_model),
    pg_catalog.upper(pg_catalog.btrim(p_registration_number)), p_capacity
  ) returning id into v_vehicle;

  perform private.write_audit(v_driver, 'driver_vehicle_submitted', 'vehicle',
    v_vehicle, pg_catalog.jsonb_build_object('vehicle_type', p_vehicle_type));
  return v_vehicle;
end;
$$;

alter function public.submit_driver_vehicle(text, text, text, text, integer)
  owner to movara_workflow_owner;
reset role;
revoke movara_workflow_owner from postgres;
revoke create on schema public from movara_workflow_owner;

revoke all on function public.submit_driver_vehicle(text, text, text, text, integer)
  from public, anon;
grant execute on function public.submit_driver_vehicle(text, text, text, text, integer)
  to authenticated;
