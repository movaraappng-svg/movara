create extension if not exists pgtap with schema extensions;

begin;
select plan(82);

select ok(to_regclass('public.profiles') is not null, 'profiles table exists');
select ok(to_regclass('public.tenancy_search_cycles') is not null, 'cycle table exists');
select ok(to_regclass('public.property_viewings') is not null, 'viewings table exists');
select ok(to_regclass('public.connection_outcomes') is not null, 'outcomes table exists');
select ok(to_regclass('public.landlord_connection_fees') is not null, 'fees table exists');
select ok((select relrowsecurity from pg_class
  where oid = 'public.property_viewings'::regclass), 'viewing RLS is enabled');
select ok((select relrowsecurity from pg_class
  where oid = 'public.landlord_connection_fees'::regclass), 'fee RLS is enabled');
select ok(not has_table_privilege('authenticated',
  'public.landlord_connection_fees', 'INSERT'), 'clients cannot insert fees');
select ok(not has_table_privilege('authenticated',
  'public.landlord_connection_fees', 'UPDATE'), 'clients cannot update fees');
select ok(not has_table_privilege('authenticated',
  'public.landlord_connection_fee_settings', 'INSERT'),
  'clients cannot insert fee settings');
select ok(not has_table_privilege('authenticated',
  'public.connection_outcomes', 'INSERT'), 'clients cannot create outcomes');
select ok(not has_function_privilege('authenticated',
  'public.record_verified_fee_payment(uuid,text,text,text,bigint,character)',
  'EXECUTE'), 'clients cannot invoke payment callback');
select ok(has_function_privilege('service_role',
  'public.record_verified_fee_payment(uuid,text,text,text,bigint,character)',
  'EXECUTE'), 'trusted payment role can invoke callback');
select ok(has_function_privilege('service_role',
  'public.prepare_landlord_fee_payment(uuid)', 'EXECUTE'),
  'trusted payment role can preflight fee collection');
select ok(not has_function_privilege('authenticated',
  'public.prepare_landlord_fee_payment(uuid)', 'EXECUTE'),
  'clients cannot invoke payment preflight');
select ok(not has_function_privilege('authenticated',
  'public.provision_user_role(uuid,public.app_role,text)', 'EXECUTE'),
  'clients cannot provision roles');
select ok(not has_table_privilege('authenticated', 'public.user_roles', 'INSERT'),
  'customers cannot grant themselves roles');
select ok(not has_table_privilege('authenticated',
  'public.driver_verifications', 'UPDATE'),
  'drivers cannot self-approve verification');
select ok(not has_table_privilege('authenticated',
  'public.property_verifications', 'UPDATE'),
  'landlords cannot self-verify properties');
select ok(not has_table_privilege('authenticated',
  'public.ride_requests', 'UPDATE'),
  'drivers cannot directly alter ride request outcomes');
select ok(to_regclass('public.property_viewings_one_active_per_enquiry') is not null,
  'one active viewing per enquiry index exists');
select ok(to_regclass('public.connection_outcomes') is not null
  and exists (select 1 from pg_constraint
    where conrelid = 'public.connection_outcomes'::regclass
      and conname = 'connection_outcomes_tenancy_cycle_id_key'),
  'one outcome per tenancy cycle is constrained');
select ok(exists (select 1 from pg_constraint
  where conrelid = 'public.landlord_connection_fee_settings'::regclass
    and contype = 'x'), 'fee settings have an overlap exclusion constraint');
select ok((select prosecdef and coalesce(array_to_string(proconfig, ','), '')
    like '%search_path=%' from pg_proc
    where oid = 'public.confirm_property_viewing(uuid)'::regprocedure),
    'confirmation RPC is SECURITY DEFINER with a fixed search path');
select ok((select count(*) >= 3 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname in ('property_image_object_read',
        'property_image_object_insert', 'identity_document_object_read',
        'identity_document_object_insert')),
    'private storage has owner-scoped policies');

-- Ephemeral fixtures are rolled back; these are not real users or listings.
insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) values
 ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'tenant-test@movara.invalid', 'not-a-password',
  now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Test tenant"}',
  now(), now()),
 ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'landlord-test@movara.invalid', 'not-a-password',
  now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Test landlord"}',
  now(), now()),
 ('00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'admin-test@movara.invalid', 'not-a-password',
  now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Test admin"}',
  now(), now()),
 ('00000000-0000-0000-0000-000000000104', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'outsider-test@movara.invalid', 'not-a-password',
  now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Test outsider"}',
  now(), now());

insert into public.user_roles(user_id, role) values
 ('00000000-0000-0000-0000-000000000102', 'landlord'),
 ('00000000-0000-0000-0000-000000000103', 'administrator');

insert into public.properties(
  id, landlord_id, title, category, transaction_type, price_ngn_kobo,
  state_code, lga_id, address, status
) values (
  '00000000-0000-0000-0000-000000000201',
  '00000000-0000-0000-0000-000000000102',
  'Test-only listing', 'one_bedroom', 'rent', 10000000,
  'NG-EN', (select id from public.nigerian_lgas
    where state_code = 'NG-EN' and name = 'Enugu North'),
  'Test-only address', 'published'
);

insert into public.enquiries(
  id, property_id, landlord_id, customer_id, idempotency_key
) values (
  '00000000-0000-0000-0000-000000000301',
  '00000000-0000-0000-0000-000000000201',
  '00000000-0000-0000-0000-000000000102',
  '00000000-0000-0000-0000-000000000101',
  '00000000-0000-0000-0000-000000000401'
);
insert into public.enquiry_messages(
  enquiry_id, sender_id, body, idempotency_key
) values (
  '00000000-0000-0000-0000-000000000301',
  '00000000-0000-0000-0000-000000000101',
  'Test-only enquiry message', '00000000-0000-0000-0000-000000000401'
);

insert into public.tenancy_search_cycles(
  id, property_id, landlord_id, tenant_id, cycle_number, created_by
) values (
  '00000000-0000-0000-0000-000000000501',
  '00000000-0000-0000-0000-000000000201',
  '00000000-0000-0000-0000-000000000102',
  '00000000-0000-0000-0000-000000000101', 1,
  '00000000-0000-0000-0000-000000000101'
);

insert into public.property_viewings(
  id, enquiry_id, property_id, landlord_id, tenant_id, tenancy_cycle_id,
  requested_by, idempotency_key, proposed_at
) values (
  '00000000-0000-0000-0000-000000000601',
  '00000000-0000-0000-0000-000000000301',
  '00000000-0000-0000-0000-000000000201',
  '00000000-0000-0000-0000-000000000102',
  '00000000-0000-0000-0000-000000000101',
  '00000000-0000-0000-0000-000000000501',
  '00000000-0000-0000-0000-000000000101',
  '00000000-0000-0000-0000-000000000701', now() + interval '1 day'
);

insert into public.landlord_connection_fee_settings(
  id, amount_kobo, due_interval_hours, effective_from, created_by
) values (
  '00000000-0000-0000-0000-000000000801', 250000, 168,
  now() - interval '1 day', '00000000-0000-0000-0000-000000000103'
);

select throws_ok($$insert into public.property_viewings(
  id, enquiry_id, property_id, landlord_id, tenant_id, tenancy_cycle_id,
  requested_by, idempotency_key, proposed_at
) values (
  '00000000-0000-0000-0000-000000000605',
  '00000000-0000-0000-0000-000000000301',
  '00000000-0000-0000-0000-000000000999',
  '00000000-0000-0000-0000-000000000102',
  '00000000-0000-0000-0000-000000000101',
  '00000000-0000-0000-0000-000000000501',
  '00000000-0000-0000-0000-000000000101',
  '00000000-0000-0000-0000-000000000705', now() + interval '1 day'
)$$, '23503', null,
  'viewing with a property inconsistent with its enquiry is rejected');
select throws_ok($$insert into public.property_viewings(
  id, enquiry_id, property_id, landlord_id, tenant_id, tenancy_cycle_id,
  requested_by, idempotency_key, proposed_at
) values (
  '00000000-0000-0000-0000-000000000606',
  '00000000-0000-0000-0000-000000000301',
  '00000000-0000-0000-0000-000000000201',
  '00000000-0000-0000-0000-000000000102',
  '00000000-0000-0000-0000-000000000101',
  '00000000-0000-0000-0000-000000000501',
  '00000000-0000-0000-0000-000000000101',
  '00000000-0000-0000-0000-000000000706', now() + interval '2 days'
)$$, '23505', null,
  'a second active appointment in the enquiry is rejected');

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select set_config('request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000101', true);
select lives_ok($$select public.send_enquiry_message(
  '00000000-0000-0000-0000-000000000301',
  'Test-only follow-up', '00000000-0000-0000-0000-000000000707')$$,
  'enquiry participant can add a thread message');
select is(public.send_enquiry_message(
  '00000000-0000-0000-0000-000000000301',
  'Test-only follow-up', '00000000-0000-0000-0000-000000000707'),
  (select id from public.enquiry_messages
    where idempotency_key = '00000000-0000-0000-0000-000000000707'),
  'message retry returns the original message');
select lives_ok(
  $$select public.confirm_property_viewing(
    '00000000-0000-0000-0000-000000000601')$$,
  'tenant can confirm only their own side');
select is((select count(*)::integer from public.connection_outcomes), 0,
  'one confirmation does not create an outcome');
select is((select count(*)::integer from public.landlord_connection_fees), 0,
  'one confirmation does not create a fee');

select set_config('request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000104', true);
select throws_ok(
  $$select public.confirm_property_viewing(
    '00000000-0000-0000-0000-000000000601')$$,
  '42501', 'Viewing confirmation not permitted',
  'unrelated user cannot confirm the viewing');
select is((select count(*)::integer from public.property_viewings), 0,
  'unrelated user cannot read viewing details');
select is((select count(*)::integer from public.enquiry_messages), 0,
  'unrelated user cannot read conversation messages');

select set_config('request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000102', true);
select lives_ok(
  $$select public.confirm_property_viewing(
    '00000000-0000-0000-0000-000000000601')$$,
  'landlord can confirm their own side');
select is((select count(*)::integer from public.connection_outcomes), 1,
  'mutual confirmation creates exactly one outcome');
select is((select count(*)::integer from public.landlord_connection_fees), 1,
  'mutual confirmation creates one landlord fee');
select is((select landlord_id from public.landlord_connection_fees limit 1),
  '00000000-0000-0000-0000-000000000102'::uuid,
  'landlord is the only connection-fee payer');
select is((select amount_kobo from public.landlord_connection_fees limit 1),
  250000::bigint, 'fee amount is snapshotted from configuration in kobo');
select set_config('request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000101', true);
select is((select count(*)::integer from public.landlord_connection_fees), 0,
  'tenant cannot read or owe landlord connection fees');
select is((select count(*)::integer from public.landlord_connection_fee_settings), 0,
  'tenant cannot read administrator fee settings');

select set_config('request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000103', true);
select throws_ok(
  $$select public.configure_landlord_connection_fee(
    300000, now(), null, 48)$$,
  '23P01', null, 'overlapping active fee configuration is rejected');

reset role;
update public.property_viewings set status = 'closed'
  where id = '00000000-0000-0000-0000-000000000601';
insert into public.property_viewings(
  id, enquiry_id, property_id, landlord_id, tenant_id, tenancy_cycle_id,
  requested_by, idempotency_key, proposed_at
) values (
  '00000000-0000-0000-0000-000000000602',
  '00000000-0000-0000-0000-000000000301',
  '00000000-0000-0000-0000-000000000201',
  '00000000-0000-0000-0000-000000000102',
  '00000000-0000-0000-0000-000000000101',
  '00000000-0000-0000-0000-000000000501',
  '00000000-0000-0000-0000-000000000101',
  '00000000-0000-0000-0000-000000000702', now() + interval '2 days'
);
set local role authenticated;
select set_config('request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000101', true);
select lives_ok($$select public.confirm_property_viewing(
  '00000000-0000-0000-0000-000000000602')$$,
  'later appointment in the same cycle can be confirmed');
select set_config('request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000102', true);
select lives_ok($$select public.confirm_property_viewing(
  '00000000-0000-0000-0000-000000000602')$$,
  'duplicate cycle confirmation returns the existing outcome');
select is((select count(*)::integer from public.connection_outcomes), 1,
  'subsequent appointment does not create a second cycle outcome');
select is((select count(*)::integer from public.landlord_connection_fees), 1,
  'subsequent appointment does not create another fee');

reset role;
update public.property_viewings set status = 'closed'
  where id = '00000000-0000-0000-0000-000000000602';
update public.tenancy_search_cycles set status = 'closed', closed_at = now()
  where id = '00000000-0000-0000-0000-000000000501';
set local role authenticated;
select set_config('request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000101', true);
select throws_ok(
  $$select public.open_next_tenancy_cycle(
    '00000000-0000-0000-0000-000000000201',
    '00000000-0000-0000-0000-000000000102',
    '00000000-0000-0000-0000-000000000101', 'test')$$,
  '42501', 'Cycle creation requires authorized administration',
  'tenant cannot create a new tenancy cycle');
select set_config('request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000103', true);
select lives_ok(
  $$select public.open_next_tenancy_cycle(
    '00000000-0000-0000-0000-000000000201',
    '00000000-0000-0000-0000-000000000102',
    '00000000-0000-0000-0000-000000000101', 'approved test cycle')$$,
  'administrator can open a new cycle with a reason');
select is((select count(*)::integer from public.tenancy_search_cycles), 2,
  'new cycle gets a distinct database-generated identifier');

reset role;
insert into public.property_viewings(
  id, enquiry_id, property_id, landlord_id, tenant_id, tenancy_cycle_id,
  requested_by, idempotency_key, proposed_at
) values (
  '00000000-0000-0000-0000-000000000603',
  '00000000-0000-0000-0000-000000000301',
  '00000000-0000-0000-0000-000000000201',
  '00000000-0000-0000-0000-000000000102',
  '00000000-0000-0000-0000-000000000101',
  (select id from public.tenancy_search_cycles where cycle_number = 2),
  '00000000-0000-0000-0000-000000000101',
  '00000000-0000-0000-0000-000000000703', now() + interval '3 days'
);
set local role authenticated;
select set_config('request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000101', true);
select lives_ok($$select public.cancel_property_viewing(
  '00000000-0000-0000-0000-000000000603', 'test cancellation')$$,
  'party can cancel an unconfirmed viewing');
select is((select count(*)::integer from public.connection_outcomes), 1,
  'pre-confirmation cancellation creates no outcome');
select throws_ok($$select public.confirm_property_viewing(
  '00000000-0000-0000-0000-000000000603')$$,
  '22023', 'Viewing cannot be confirmed in its current state',
  'cancelled viewing cannot later be confirmed');

reset role;
insert into public.property_viewings(
  id, enquiry_id, property_id, landlord_id, tenant_id, tenancy_cycle_id,
  requested_by, idempotency_key, proposed_at
) values (
  '00000000-0000-0000-0000-000000000604',
  '00000000-0000-0000-0000-000000000301',
  '00000000-0000-0000-0000-000000000201',
  '00000000-0000-0000-0000-000000000102',
  '00000000-0000-0000-0000-000000000101',
  (select id from public.tenancy_search_cycles where cycle_number = 2),
  '00000000-0000-0000-0000-000000000101',
  '00000000-0000-0000-0000-000000000704', now() + interval '4 days'
);
set local role authenticated;
select set_config('request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000101', true);
select is(public.create_property_viewing(
  '00000000-0000-0000-0000-000000000301',
  (select id from public.tenancy_search_cycles where cycle_number = 2),
  (select proposed_at from public.property_viewings
    where id = '00000000-0000-0000-0000-000000000604'),
  '00000000-0000-0000-0000-000000000704'),
  '00000000-0000-0000-0000-000000000604'::uuid,
  'viewing creation retry returns the original appointment');
select lives_ok($$select public.request_viewing_reschedule(
  '00000000-0000-0000-0000-000000000604', now() + interval '5 days')$$,
  'party can request an unconfirmed viewing reschedule');
select set_config('request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000102', true);
select lives_ok(format(
  'select public.respond_viewing_reschedule(%L, true, %L)',
  (select id from public.property_viewing_reschedules
    where viewing_id = '00000000-0000-0000-0000-000000000604'),
  'accepted test reschedule'),
  'other party can accept a reschedule');
select is((select proposed_at::date from public.property_viewings
  where id = '00000000-0000-0000-0000-000000000604'),
  (now() + interval '5 days')::date,
  'accepted reschedule updates appointment time');
select is((select count(*)::integer from public.property_viewings
  where id = '00000000-0000-0000-0000-000000000604'
    and tenant_confirmed_at is null and landlord_confirmed_at is null
    and status = 'proposed'), 1,
  'rescheduling requires fresh mutual confirmation');

select set_config('request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000101', true);
select throws_ok(format(
  'select public.prepare_landlord_fee_payment(%L)',
  (select id from public.landlord_connection_fees limit 1)),
  '42501', 'permission denied for function prepare_landlord_fee_payment',
  'authenticated caller is denied payment preflight');
select lives_ok(format(
  'select public.open_connection_fee_dispute(%L, %L)',
  (select id from public.landlord_connection_fees limit 1), 'test dispute'),
  'relevant party can open a fee dispute');
select is((select status::text from public.landlord_connection_fees limit 1),
  'disputed', 'disputed fee is held');
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
reset role;
set local role service_role;
select throws_ok(format(
  'select public.prepare_landlord_fee_payment(%L)',
  (select id from public.landlord_connection_fees limit 1)),
  '22023', 'Fee is not collectible',
  'disputed fee cannot pass payment preflight');
select throws_ok(format(
  'select public.record_verified_fee_payment(%L, %L, %L, %L, %s, %L::char(3))',
  (select id from public.landlord_connection_fees limit 1),
  'test-provider', 'test-reference', 'test-event-disputed',
  (select amount_kobo from public.landlord_connection_fees limit 1), 'NGN'),
  '22023', 'Fee is not payable or payment amount mismatches',
  'trusted payment retry cannot collect a disputed fee');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select set_config('request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000103', true);
select lives_ok(format(
  'select public.resolve_connection_fee_dispute(%L, false, %L)',
  (select id from public.disputes where landlord_fee_id is not null limit 1),
  'fee confirmed after review'),
  'administrator can resolve dispute without waiver');
select is((select status::text from public.landlord_connection_fees limit 1),
  'pending', 'resolved fee returns to collectible state');

select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
reset role;
set local role service_role;
select is(
  public.prepare_landlord_fee_payment(
    (select id from public.landlord_connection_fees limit 1)),
  pg_catalog.jsonb_build_object(
    'fee_id', (select id from public.landlord_connection_fees limit 1),
    'payer_id', (select landlord_id from public.landlord_connection_fees limit 1),
    'amount_kobo', (select amount_kobo from public.landlord_connection_fees limit 1),
    'currency', (select currency from public.landlord_connection_fees limit 1),
    'due_at', (select due_at from public.landlord_connection_fees limit 1)
  ),
  'resolved fee preflight returns the authoritative payer and amount');
select lives_ok(format(
  'select public.record_failed_fee_payment(%L, %L, %L, %L, %s, %L::char(3), %L)',
  (select id from public.landlord_connection_fees limit 1),
  'test-provider', 'test-reference', 'test-event-failed',
  (select amount_kobo from public.landlord_connection_fees limit 1),
  'NGN', 'declined'),
  'verified provider failure is recorded for retry');
select is((select status::text from public.landlord_connection_fees limit 1),
  'failed', 'failed payment remains retryable');
select lives_ok(format(
  'select public.record_verified_fee_payment(%L, %L, %L, %L, %s, %L::char(3))',
  (select id from public.landlord_connection_fees limit 1),
  'test-provider', 'test-reference', 'test-event-success',
  (select amount_kobo from public.landlord_connection_fees limit 1), 'NGN'),
  'verified provider payment succeeds after dispute resolution');
select lives_ok(format(
  'select public.record_verified_fee_payment(%L, %L, %L, %L, %s, %L::char(3))',
  (select id from public.landlord_connection_fees limit 1),
  'test-provider', 'test-reference', 'test-event-success',
  (select amount_kobo from public.landlord_connection_fees limit 1), 'NGN'),
  'identical provider callback retry is idempotent');
select is((select count(*)::integer from public.payments
  where provider = 'test-provider' and provider_event_id = 'test-event-success'), 1,
  'payment retry creates a single payment record');
select is((select status::text from public.landlord_connection_fees limit 1),
  'paid', 'trusted payment marks the landlord fee paid');

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select set_config('request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000101', true);
select lives_ok($$select public.confirm_property_viewing(
  '00000000-0000-0000-0000-000000000604')$$,
  'tenant confirms the next cycle viewing');
select set_config('request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000102', true);
select lives_ok($$select public.confirm_property_viewing(
  '00000000-0000-0000-0000-000000000604')$$,
  'landlord confirms the next cycle viewing');
select is((select count(*)::integer from public.connection_outcomes), 2,
  'new authorized cycle can have its own outcome');
select is((select count(*)::integer from public.landlord_connection_fees), 2,
  'a new authorized cycle can create one additional landlord fee');
select set_config('request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000101', true);
select lives_ok(format(
  'select public.open_connection_fee_dispute(%L, %L)',
  (select f.id from public.landlord_connection_fees f
    join public.connection_outcomes o on o.id = f.connection_outcome_id
    join public.tenancy_search_cycles c on c.id = o.tenancy_cycle_id
    where c.cycle_number = 2),
  'waiver-path test dispute'),
  'second cycle fee can be disputed independently');
select set_config('request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000103', true);
select lives_ok(format(
  'select public.resolve_connection_fee_dispute(%L, true, %L)',
  (select d.id from public.disputes d
    join public.landlord_connection_fees f on f.id = d.landlord_fee_id
    join public.connection_outcomes o on o.id = f.connection_outcome_id
    join public.tenancy_search_cycles c on c.id = o.tenancy_cycle_id
    where c.cycle_number = 2),
  'waived after review'),
  'administrator can resolve a dispute with a waiver');
select is((select f.status::text from public.landlord_connection_fees f
  join public.connection_outcomes o on o.id = f.connection_outcome_id
  join public.tenancy_search_cycles c on c.id = o.tenancy_cycle_id
  where c.cycle_number = 2), 'waived',
  'waiver permanently removes collectibility');
select is((select count(*)::integer from public.property_viewing_events
  where event_type = 'fee_waived'), 1,
  'waiver is recorded in the viewing event audit');
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
reset role;
set local role service_role;
select throws_ok(format(
  'select public.prepare_landlord_fee_payment(%L)',
  (select f.id from public.landlord_connection_fees f
    join public.connection_outcomes o on o.id = f.connection_outcome_id
    join public.tenancy_search_cycles c on c.id = o.tenancy_cycle_id
    where c.cycle_number = 2)),
  '22023', 'Fee is not collectible',
  'waived fee cannot pass payment preflight');
select throws_ok(format(
  'select public.record_verified_fee_payment(%L, %L, %L, %L, %s, %L::char(3))',
  (select f.id from public.landlord_connection_fees f
    join public.connection_outcomes o on o.id = f.connection_outcome_id
    join public.tenancy_search_cycles c on c.id = o.tenancy_cycle_id
    where c.cycle_number = 2),
  'test-provider', 'waived-reference', 'test-event-waived',
  (select f.amount_kobo from public.landlord_connection_fees f
    join public.connection_outcomes o on o.id = f.connection_outcome_id
    join public.tenancy_search_cycles c on c.id = o.tenancy_cycle_id
    where c.cycle_number = 2), 'NGN'),
  '22023', 'Fee is not payable or payment amount mismatches',
  'waived fee cannot be collected');

reset role;
select * from finish();
rollback;
