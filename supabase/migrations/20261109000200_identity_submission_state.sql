-- Distinguish submitted documents from cases actively under administrator review.
alter type public.verification_status add value if not exists 'submitted' before 'pending';

grant movara_workflow_owner to postgres with set true, inherit false;
grant create on schema public to movara_workflow_owner;
set role movara_workflow_owner;

create or replace function public.request_marketplace_role(p_role public.app_role)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_request uuid;
begin
  if v_user is null or p_role not in ('driver', 'landlord') then
    raise exception 'Role request not permitted' using errcode = '42501';
  end if;
  insert into public.role_requests(user_id, requested_role)
  values (v_user, p_role)
  on conflict (user_id, requested_role) do update
    set status = case when public.role_requests.status = 'rejected'
      then 'pending'::public.verification_status else public.role_requests.status end,
      updated_at = pg_catalog.now()
  returning id into v_request;
  if p_role = 'driver' then
    insert into public.driver_verifications(driver_id) values (v_user)
      on conflict (driver_id) do update set status = case
        when public.driver_verifications.status = 'rejected'
          then 'not_submitted'::public.verification_status
        else public.driver_verifications.status end,
        reviewed_at = case when public.driver_verifications.status = 'rejected'
          then null else public.driver_verifications.reviewed_at end,
        reviewed_by = case when public.driver_verifications.status = 'rejected'
          then null else public.driver_verifications.reviewed_by end,
        updated_at = pg_catalog.now();
  else
    insert into public.landlord_verifications(landlord_id) values (v_user)
      on conflict (landlord_id) do update set status = case
        when public.landlord_verifications.status = 'rejected'
          then 'not_submitted'::public.verification_status
        else public.landlord_verifications.status end,
        reviewed_at = case when public.landlord_verifications.status = 'rejected'
          then null else public.landlord_verifications.reviewed_at end,
        reviewed_by = case when public.landlord_verifications.status = 'rejected'
          then null else public.landlord_verifications.reviewed_by end,
        updated_at = pg_catalog.now();
  end if;
  perform private.write_audit(v_user, 'role_requested', 'role_request',
    v_request, pg_catalog.jsonb_build_object('role', p_role::text));
  return v_request;
end;
$$;

create or replace function public.submit_identity_for_review(p_role text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null or p_role not in ('driver', 'landlord') then
    raise exception 'Identity submission not permitted' using errcode = '42501';
  end if;
  if p_role = 'driver' then
    if not exists (select 1 from public.driver_documents d where d.driver_id = v_user) then
      raise exception 'Upload a driver identity document first' using errcode = '22023';
    end if;
    update public.driver_verifications set status = 'submitted', updated_at = pg_catalog.now()
      where driver_id = v_user and status in ('not_submitted', 'rejected');
  else
    if not exists (select 1 from public.landlord_documents d where d.landlord_id = v_user) then
      raise exception 'Upload a landlord identity document first' using errcode = '22023';
    end if;
    update public.landlord_verifications set status = 'submitted', updated_at = pg_catalog.now()
      where landlord_id = v_user and status in ('not_submitted', 'rejected');
  end if;
  update public.role_requests set status = 'pending', updated_at = pg_catalog.now()
    where user_id = v_user and requested_role::text = p_role
      and status in ('pending', 'rejected');
end;
$$;

create function public.admin_start_identity_review(p_subject_type text, p_subject_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_prior public.verification_status;
begin
  if v_user is null or not private.has_role('administrator')
    or p_subject_type not in ('driver', 'landlord') then
    raise exception 'Identity review not permitted' using errcode = '42501';
  end if;
  if p_subject_type = 'driver' then
    update public.driver_verifications set status = 'pending',
      reviewed_at = pg_catalog.now(), reviewed_by = v_user,
      updated_at = pg_catalog.now()
      where driver_id = p_subject_id and status = 'submitted'
      returning 'submitted'::public.verification_status into v_prior;
  else
    update public.landlord_verifications set status = 'pending',
      reviewed_at = pg_catalog.now(), reviewed_by = v_user,
      updated_at = pg_catalog.now()
      where landlord_id = p_subject_id and status = 'submitted'
      returning 'submitted'::public.verification_status into v_prior;
  end if;
  if v_prior is null then
    raise exception 'No submitted identity review is available' using errcode = '22023';
  end if;
  insert into public.verification_audit_logs(actor_id, subject_id,
    subject_type, subject_entity_id, prior_status, new_status, reason)
  values (v_user, p_subject_id, p_subject_type, p_subject_id,
    v_prior, 'pending', 'Administrator started manual identity review');
end;
$$;
alter function public.admin_start_identity_review(text, uuid) owner to movara_workflow_owner;
reset role;
revoke movara_workflow_owner from postgres;
revoke create on schema public from movara_workflow_owner;
revoke all on function public.admin_start_identity_review(text, uuid) from public, anon;
grant execute on function public.admin_start_identity_review(text, uuid) to authenticated;
