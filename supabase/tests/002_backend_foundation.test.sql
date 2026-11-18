create extension if not exists pgtap with schema extensions;

begin;
select plan(19);

select has_table('public', 'driver_profiles', 'driver profiles table exists');
select has_column('public', 'properties', 'bedrooms',
  'property bedrooms are represented');
select has_column('public', 'properties', 'bathrooms',
  'property bathrooms are represented');
select ok((select relrowsecurity from pg_catalog.pg_class
  where oid = 'public.driver_profiles'::regclass),
  'driver profile RLS is enabled');
select has_policy('public', 'driver_profiles', 'driver_profile_read_self_admin',
  'driver profiles have owner-scoped reads');
select has_policy('public', 'driver_profiles', 'driver_profile_create_self',
  'drivers can create only their own profile');
select has_policy('public', 'driver_profiles',
  'driver_profile_update_availability',
  'availability updates require the approved driver conditions');
select ok(has_column_privilege('authenticated',
  'public.driver_profiles', 'driver_id', 'INSERT'),
  'authenticated clients may insert only the driver profile key');
select ok(not has_column_privilege('authenticated',
  'public.driver_profiles', 'is_online', 'INSERT'),
  'driver profile insertion defaults to offline');
select ok(has_column_privilege('authenticated',
  'public.driver_profiles', 'is_online', 'UPDATE'),
  'drivers may request an availability update');
select ok(not has_column_privilege('authenticated',
  'public.driver_profiles', 'driver_id', 'UPDATE'),
  'drivers cannot change profile ownership');
select has_policy('public', 'properties', 'properties_create_as_landlord',
  'landlord property creation is owner-scoped');
select has_policy('public', 'properties', 'properties_delete_unpublished_as_owner',
  'landlord deletion is limited to unpublished listings');
select ok(not has_column_privilege('authenticated',
  'public.properties', 'status', 'INSERT'),
  'property clients cannot choose moderation status on insert');
select has_policy('public', 'favourites', 'favourites_add_own_published_property',
  'favourites are limited to owned user and published listing');
select has_policy('public', 'rides', 'rides_create_own_request',
  'ride creation is limited to the authenticated customer');
select has_policy('public', 'notifications',
  'notifications_mark_own_read',
  'notification recipients may mark their own notifications read');
select ok(exists (
  select 1 from storage.buckets
  where id = 'profile-photos'
    and not public
    and file_size_limit = 5242880
), 'profile photo bucket is private and size-limited');
select ok(exists (
  select 1 from pg_catalog.pg_publication_tables
  where pubname = 'supabase_realtime'
    and schemaname = 'public'
    and tablename = 'driver_profiles'
), 'driver profiles are in the Realtime publication');

select * from finish();
rollback;
