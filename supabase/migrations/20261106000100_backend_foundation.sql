-- Phase 1 additions to the reviewed MoVara Supabase foundation.
-- Existing demo screens remain local; no project credentials are required.

alter table public.properties
  add column bedrooms smallint not null default 0
    check (bedrooms between 0 and 50),
  add column bathrooms smallint not null default 0
    check (bathrooms between 0 and 50);

create table public.driver_profiles (
  driver_id uuid primary key references public.profiles(id) on delete cascade,
  is_online boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index driver_profiles_online_idx
  on public.driver_profiles(updated_at desc)
  where is_online;
create index property_images_property_order_idx
  on public.property_images(property_id, sort_order);

create trigger driver_profiles_updated_at
before update on public.driver_profiles
for each row execute function private.set_updated_at();

alter table public.driver_profiles enable row level security;

revoke all on public.driver_profiles from anon, authenticated;
grant select on public.driver_profiles to authenticated;
grant insert (driver_id) on public.driver_profiles to authenticated;
grant update (is_online) on public.driver_profiles to authenticated;

create policy driver_profile_read_self_admin
  on public.driver_profiles
  for select to authenticated
  using (
    driver_id = (select auth.uid())
    or (select private.has_role('administrator'))
  );

create policy driver_profile_create_self
  on public.driver_profiles
  for insert to authenticated
  with check (
    driver_id = (select auth.uid())
    and (select private.has_role('driver'))
  );

create policy driver_profile_update_availability
  on public.driver_profiles
  for update to authenticated
  using (
    driver_id = (select auth.uid())
    and (select private.has_role('driver'))
  )
  with check (
    driver_id = (select auth.uid())
    and (select private.has_role('driver'))
    and (
      not is_online
      or (
        exists (
          select 1 from public.driver_verifications v
          where v.driver_id = (select auth.uid())
            and v.status = 'approved'
        )
        and exists (
          select 1 from public.vehicles v
          where v.driver_id = (select auth.uid())
            and v.verification = 'approved'
        )
      )
    )
  );

grant insert (
  landlord_id, title, description, category, transaction_type,
  price_ngn_kobo, currency, state_code, lga_id, neighbourhood_id,
  address, bedrooms, bathrooms
) on public.properties to authenticated;
grant update (
  title, description, category, transaction_type, price_ngn_kobo,
  state_code, lga_id, neighbourhood_id, address, bedrooms, bathrooms
) on public.properties to authenticated;
grant delete on public.properties to authenticated;

create policy properties_create_as_landlord
  on public.properties
  for insert to authenticated
  with check (
    landlord_id = (select auth.uid())
    and (select private.has_role('landlord'))
    and status = 'draft'
    and verification = 'not_submitted'
  );

create policy properties_update_as_owner
  on public.properties
  for update to authenticated
  using (
    landlord_id = (select auth.uid())
    and (select private.has_role('landlord'))
  )
  with check (
    landlord_id = (select auth.uid())
    and (select private.has_role('landlord'))
  );

create function private.can_delete_unpublished_property(
  p_property_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.properties p
    where p.id = p_property_id
      and p.landlord_id = (select auth.uid())
      and p.status in ('draft', 'rejected')
      and not exists (
        select 1
        from public.property_images i
        where i.property_id = p.id
      )
  );
$$;
revoke all on function private.can_delete_unpublished_property(uuid)
  from public, anon;
grant execute on function private.can_delete_unpublished_property(uuid)
  to authenticated;

create policy properties_delete_unpublished_as_owner
  on public.properties
  for delete to authenticated
  using ((select private.can_delete_unpublished_property(id)));

grant insert (user_id, property_id), delete
  on public.favourites to authenticated;

create policy favourites_add_own_published_property
  on public.favourites
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (select private.has_role('customer'))
    and exists (
      select 1 from public.properties p
      where p.id = property_id and p.status = 'published'
    )
  );

create policy favourites_remove_own
  on public.favourites
  for delete to authenticated
  using (
    user_id = (select auth.uid())
    and (select private.has_role('customer'))
  );

grant insert (
  customer_id, pickup_label, destination_label, passenger_count,
  estimated_fare_ngn_kobo
) on public.rides to authenticated;

create policy rides_create_own_request
  on public.rides
  for insert to authenticated
  with check (
    customer_id = (select auth.uid())
    and (select private.has_role('customer'))
    and driver_id is null
    and vehicle_id is null
    and status = 'requested'
  );

grant update (read_at) on public.notifications to authenticated;

create policy notifications_mark_own_read
  on public.notifications
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

insert into storage.buckets (
  id, name, public, file_size_limit, allowed_mime_types
) values (
  'profile-photos', 'profile-photos', false, 5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy profile_photo_read_owner
  on storage.objects
  for select to authenticated
  using (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy profile_photo_insert_owner
  on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy profile_photo_update_owner
  on storage.objects
  for update to authenticated
  using (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy profile_photo_delete_owner
  on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

do $$
declare
  table_name text;
begin
  if exists (
    select 1 from pg_catalog.pg_publication
    where pubname = 'supabase_realtime'
  ) then
    foreach table_name in array array[
      'driver_profiles', 'rides', 'notifications'
    ] loop
      if not exists (
        select 1 from pg_catalog.pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = table_name
      ) then
        execute pg_catalog.format(
          'alter publication supabase_realtime add table public.%I',
          table_name
        );
      end if;
    end loop;
  end if;
end;
$$;
