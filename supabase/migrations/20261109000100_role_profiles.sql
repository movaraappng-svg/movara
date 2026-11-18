-- Role profile details, private profile images, and editable profile persistence.
-- Identity decisions remain exclusively in the existing admin review RPC workflow.

create table public.customer_profiles (
  customer_id uuid primary key references public.profiles(id) on delete cascade,
  residential_address text not null default '',
  bio text not null default '',
  updated_at timestamptz not null default now()
);
create table public.driver_profile_details (
  driver_id uuid primary key references public.profiles(id) on delete cascade,
  residential_address text not null default '',
  licence_number text not null default '',
  vehicle_registration text not null default '',
  vehicle_make text not null default '',
  vehicle_model text not null default '',
  vehicle_colour text not null default '',
  vehicle_year text not null default '',
  service_areas text not null default '',
  bio text not null default '',
  emergency_contact text not null default '',
  updated_at timestamptz not null default now()
);
create table public.landlord_profiles (
  landlord_id uuid primary key references public.profiles(id) on delete cascade,
  profile_type text not null default '',
  business_name text not null default '',
  residential_address text not null default '',
  office_address text not null default '',
  website text not null default '',
  bio text not null default '',
  preferred_contact text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.customer_profiles enable row level security;
alter table public.driver_profile_details enable row level security;
alter table public.landlord_profiles enable row level security;
grant select, insert, update on public.customer_profiles,
  public.driver_profile_details, public.landlord_profiles to authenticated;
grant update (display_name, phone, avatar_path) on public.profiles to authenticated;

create policy customer_profile_self on public.customer_profiles
  for all to authenticated using (customer_id = (select auth.uid()))
  with check (customer_id = (select auth.uid()));
create policy driver_profile_details_self on public.driver_profile_details
  for all to authenticated using (driver_id = (select auth.uid()))
  with check (driver_id = (select auth.uid()));
create policy landlord_profile_self on public.landlord_profiles
  for all to authenticated using (landlord_id = (select auth.uid()))
  with check (landlord_id = (select auth.uid()));

-- The existing backend_foundation migration already creates the private
-- profile-photos bucket and owner-scoped object policies.

create trigger customer_profiles_updated_at before update on public.customer_profiles
  for each row execute function private.set_updated_at();
create trigger driver_profile_details_updated_at before update on public.driver_profile_details
  for each row execute function private.set_updated_at();
create trigger landlord_profiles_updated_at before update on public.landlord_profiles
  for each row execute function private.set_updated_at();

create function public.submit_identity_for_review(p_role text)
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
    update public.driver_verifications set status = 'pending', updated_at = pg_catalog.now()
      where driver_id = v_user and status in ('not_submitted', 'rejected');
  else
    if not exists (select 1 from public.landlord_documents d where d.landlord_id = v_user) then
      raise exception 'Upload a landlord identity document first' using errcode = '22023';
    end if;
    update public.landlord_verifications set status = 'pending', updated_at = pg_catalog.now()
      where landlord_id = v_user and status in ('not_submitted', 'rejected');
  end if;
  update public.role_requests set status = 'pending', updated_at = pg_catalog.now()
    where user_id = v_user and requested_role::text = p_role
      and status in ('not_submitted', 'rejected');
end;
$$;
grant movara_workflow_owner to postgres with set true, inherit false;
grant create on schema public to movara_workflow_owner;
alter function public.submit_identity_for_review(text) owner to movara_workflow_owner;
revoke movara_workflow_owner from postgres;
revoke create on schema public from movara_workflow_owner;
revoke all on function public.submit_identity_for_review(text) from public, anon;
grant execute on function public.submit_identity_for_review(text) to authenticated;
