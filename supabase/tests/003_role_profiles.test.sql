create extension if not exists pgtap with schema extensions;

begin;
select plan(18);

select has_table('public', 'customer_profiles', 'customer detail profile exists');
select has_table('public', 'driver_profile_details', 'driver detail profile exists');
select has_table('public', 'landlord_profiles', 'landlord detail profile exists');
select ok((select relrowsecurity from pg_catalog.pg_class where oid = 'public.customer_profiles'::regclass), 'customer profile RLS enabled');
select ok((select relrowsecurity from pg_catalog.pg_class where oid = 'public.driver_profile_details'::regclass), 'driver profile RLS enabled');
select ok((select relrowsecurity from pg_catalog.pg_class where oid = 'public.landlord_profiles'::regclass), 'landlord profile RLS enabled');
select has_policy('public', 'customer_profiles', 'customer_profile_self', 'customer details are self scoped');
select has_policy('public', 'driver_profile_details', 'driver_profile_details_self', 'driver details are self scoped');
select has_policy('public', 'landlord_profiles', 'landlord_profile_self', 'landlord details are self scoped');
select ok(exists (select 1 from storage.buckets where id = 'profile-photos' and not public and file_size_limit = 5242880), 'profile photos use the existing private size-limited bucket');
select ok(has_function_privilege('authenticated', 'public.submit_identity_for_review(text)', 'EXECUTE'), 'signed-in users may submit identity for review');
select ok(not has_function_privilege('anon', 'public.submit_identity_for_review(text)', 'EXECUTE'), 'anonymous users cannot submit identity for review');
select has_column('public', 'driver_profile_details', 'licence_number', 'driver licence is persisted');
select has_column('public', 'driver_profile_details', 'vehicle_registration', 'driver vehicle registration is persisted');
select has_column('public', 'landlord_profiles', 'profile_type', 'landlord profile type is persisted');
select ok(exists (select 1 from pg_catalog.pg_enum e join pg_catalog.pg_type t on t.oid = e.enumtypid where t.typname = 'verification_status' and e.enumlabel = 'submitted'), 'identity can be explicitly marked submitted');
select ok(has_function_privilege('authenticated', 'public.admin_start_identity_review(text,uuid)', 'EXECUTE'), 'signed-in admin review workflow is callable');
select ok(not has_function_privilege('anon', 'public.admin_start_identity_review(text,uuid)', 'EXECUTE'), 'anonymous clients cannot start identity review');

select * from finish();
rollback;
