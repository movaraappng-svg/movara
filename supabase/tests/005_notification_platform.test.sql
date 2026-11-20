create extension if not exists pgtap with schema extensions;
begin;
select plan(16);

select has_table('public','notification_preferences','notification preferences exist');
select has_table('public','notification_delivery_logs','delivery history exists');
select has_table('public','push_devices','push device registry exists');
select has_column('public','notifications','event_key','notifications support event deduplication');
select ok((select relrowsecurity from pg_class where oid='public.notification_preferences'::regclass),'preferences enforce RLS');
select ok((select relrowsecurity from pg_class where oid='public.notification_delivery_logs'::regclass),'delivery history enforces RLS');
select ok((select relrowsecurity from pg_class where oid='public.push_devices'::regclass),'push devices enforce RLS');
select ok(has_function_privilege('authenticated','public.notification_set_preference(text,text,boolean)','EXECUTE'),'signed-in users can update scoped preferences');
select ok(not has_function_privilege('anon','public.notification_set_preference(text,text,boolean)','EXECUTE'),'anonymous users cannot update preferences');
select ok(has_function_privilege('authenticated','public.notification_register_device(text,text,text)','EXECUTE'),'signed-in users can register their device');
select ok(has_function_privilege('authenticated','public.notification_mark_all_read()','EXECUTE'),'signed-in users can clear their unread notifications');
select ok(has_function_privilege('authenticated','public.admin_notification_broadcast(text,text,text,public.app_role)','EXECUTE'),'broadcast RPC is callable and role guarded');
select has_trigger('public','rides','notification_ride_status_change','ride lifecycle changes create notifications');
select has_trigger('public','property_viewings','notification_viewing_status_change','viewing changes create notifications');
select has_trigger('public','ride_safety_events','notification_sos_insert','SOS events create notifications');
select has_trigger('public','notifications','notification_assign_event_key','legacy enquiry notifications receive idempotency keys');

select * from finish();
rollback;
