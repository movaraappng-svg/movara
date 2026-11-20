create extension if not exists pgtap with schema extensions;
begin;
select plan(22);

select has_table('public','emergency_contacts','emergency contacts exist');
select has_table('public','ride_share_links','trip shares exist');
select has_table('public','ride_safety_events','safety events exist');
select has_table('public','support_tickets','support tickets exist');
select has_table('public','support_messages','support messages exist');
select ok((select relrowsecurity from pg_class where oid='public.ride_safety_events'::regclass),'safety events enforce RLS');
select ok(not has_table_privilege('anon','public.support_tickets','SELECT'),'anonymous cannot read tickets');
select ok(not has_table_privilege('authenticated','public.support_tickets','SELECT'),'customers cannot query ticket table directly');
select ok(not has_table_privilege('authenticated','public.ride_safety_events','SELECT'),'customers cannot query safety table directly');
select ok(not has_table_privilege('authenticated','public.support_messages','SELECT'),'customers cannot query messages directly');
select ok(has_function_privilege('authenticated','public.my_support_tickets()','EXECUTE'),'authenticated users can read own tickets through scoped RPC');
select ok(not has_function_privilege('anon','public.my_support_tickets()','EXECUTE'),'anonymous users cannot read tickets');
select ok(has_function_privilege('authenticated','public.admin_list_support_tickets()','EXECUTE'),'admin listing RPC callable and role guarded');
select ok(not has_function_privilege('anon','public.admin_list_support_tickets()','EXECUTE'),'anonymous cannot invoke admin listing');
select ok(has_function_privilege('authenticated','public.admin_list_safety_events()','EXECUTE'),'admin safety RPC callable and role guarded');
select ok(not has_function_privilege('anon','public.admin_update_safety_event(uuid,text)','EXECUTE'),'anonymous cannot update safety reports');
select ok(has_function_privilege('movara_workflow_owner','auth.uid()','EXECUTE'),'workflow owner can read auth uid only while creating controlled workflows');
select ok(not has_schema_privilege('movara_workflow_owner','auth'),'workflow auth schema access revoked after creation');
select ok(not has_table_privilege('authenticated','public.ride_share_links','SELECT'),'clients cannot enumerate share tokens');
select ok(not has_table_privilege('anon','public.ride_feedback','INSERT'),'anonymous users cannot submit ratings');
select ok((select coalesce(array_to_string(proconfig,','),'') like '%search_path=%' from pg_proc where oid='public.create_support_ticket(text,text,uuid)'::regprocedure),'support creation RPC fixes search path');
select ok((select coalesce(array_to_string(proconfig,','),'') like '%search_path=%' from pg_proc where oid='public.admin_update_support_ticket(uuid,text,text)'::regprocedure),'admin update RPC fixes search path');

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-0000-0000-000000000801','00000000-0000-0000-0000-000000000000','authenticated','authenticated','safety-customer1@movara.invalid','x',now(),'{}','{"display_name":"Customer One"}',now(),now()),
 ('00000000-0000-0000-0000-000000000802','00000000-0000-0000-0000-000000000000','authenticated','authenticated','safety-customer2@movara.invalid','x',now(),'{}','{"display_name":"Customer Two"}',now(),now()),
 ('00000000-0000-0000-0000-000000000803','00000000-0000-0000-0000-000000000000','authenticated','authenticated','safety-admin@movara.invalid','x',now(),'{}','{"display_name":"Support Admin"}',now(),now());
insert into public.user_roles(user_id,role) values('00000000-0000-0000-0000-000000000803','administrator');
insert into public.support_tickets(id,reporter_id,category,message,status) values
 ('00000000-0000-0000-0000-000000000811','00000000-0000-0000-0000-000000000801','other','First customer ticket','open'),
 ('00000000-0000-0000-0000-000000000812','00000000-0000-0000-0000-000000000802','other','Second customer ticket','open');
insert into public.support_messages(ticket_id,author_id,body,internal) values
 ('00000000-0000-0000-0000-000000000811','00000000-0000-0000-0000-000000000803','Visible reply','false'),
 ('00000000-0000-0000-0000-000000000811','00000000-0000-0000-0000-000000000803','Private staff note','true');

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000801',true);
select is((select count(*)::int from public.my_support_tickets()),1,'customer sees only own support tickets');
select is((select count(*)::int from public.my_support_messages('00000000-0000-0000-0000-000000000811')),1,'customer sees only public replies, never internal notes');
select throws_ok($$select public.admin_list_safety_events()$$,'P0001','Administrator access required','customer cannot read admin safety queue');
select throws_ok($$select public.admin_update_support_ticket('00000000-0000-0000-0000-000000000811','closed','done')$$,'P0001','Administrator access required','customer cannot update ticket status');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000803',true);
select lives_ok($$select public.admin_update_support_ticket('00000000-0000-0000-0000-000000000811','in_progress','')$$,'admin can move an open ticket into progress');
select throws_ok($$select public.admin_update_support_ticket('00000000-0000-0000-0000-000000000811','closed','')$$,'P0001','That support ticket status change is not allowed','admin cannot skip from in progress to closed');
reset role;

select * from finish();
rollback;
