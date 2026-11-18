-- Require a real identity-document object before submitting verification.

create function private.identity_document_object_exists(
  p_user uuid, p_role text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from storage.objects o
    where o.bucket_id = 'identity-documents'
      and pg_catalog.split_part(o.name, '/', 1) = p_user::text
      and (
        (p_role = 'driver' and exists (
          select 1
          from public.driver_documents d
          where d.driver_id = p_user
            and d.object_path = o.name
        ))
        or (p_role = 'landlord' and exists (
          select 1
          from public.landlord_documents l
          where l.landlord_id = p_user
            and l.object_path = o.name
        ))
      )
  );
$$;
revoke all on function private.identity_document_object_exists(uuid, text)
  from public, anon, authenticated;
grant execute on function private.identity_document_object_exists(uuid, text)
  to movara_workflow_owner;

grant movara_workflow_owner to postgres with set true, inherit false;
grant create on schema public to movara_workflow_owner;
set role movara_workflow_owner;

create or replace function public.submit_identity_for_review(p_role text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null or p_role not in ('driver', 'landlord') then
    raise exception 'Identity submission not permitted' using errcode = '42501';
  end if;
  if p_role = 'driver' then
    if not private.identity_document_object_exists(v_user, p_role) then
      raise exception 'Upload a driver identity document first' using errcode = '22023';
    end if;
    update public.driver_verifications set status = 'submitted', updated_at = pg_catalog.now()
      where driver_id = v_user and status in ('not_submitted', 'rejected');
  else
    if not private.identity_document_object_exists(v_user, p_role) then
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
alter function public.submit_identity_for_review(text)
  owner to movara_workflow_owner;

reset role;
revoke movara_workflow_owner from postgres;
revoke create on schema public from movara_workflow_owner;
revoke all on function public.submit_identity_for_review(text) from public, anon;
grant execute on function public.submit_identity_for_review(text) to authenticated;
