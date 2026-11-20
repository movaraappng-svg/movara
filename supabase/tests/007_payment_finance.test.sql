begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

select has_table('public','paystack_refunds','refund requests are stored');
select has_table('public','payment_reconciliation_runs','reconciliation runs are stored');
select has_table('public','payment_reconciliation_items','reconciliation details are stored');
select has_column('public','paystack_refunds','provider_reference','refund has an idempotent provider reference');
select has_column('public','paystack_refunds','status','refund status is tracked');
select has_column('public','payment_reconciliation_items','matches','comparison result is recorded');
select ok((select relrowsecurity from pg_class where oid='public.paystack_refunds'::regclass),'refund table has RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.payment_reconciliation_runs'::regclass),'reconciliation runs have RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.payment_reconciliation_items'::regclass),'reconciliation items have RLS enabled');
select has_function('public','admin_request_paystack_refund',array['uuid','bigint','text','text'],'refund requests require the admin RPC');
select has_function('public','wallet_finalize_transfer',array['text','text','text'],'payout finalization is provider backed');
select ok(has_function_privilege('authenticated','public.admin_request_paystack_refund(uuid,bigint,text,text)','EXECUTE'),'authenticated can invoke the role checked refund RPC');
select ok(not has_function_privilege('anon','public.admin_request_paystack_refund(uuid,bigint,text,text)','EXECUTE'),'anonymous cannot invoke refund RPC');
select ok(has_function_privilege('service_role','public.wallet_finalize_transfer(text,text,text)','EXECUTE'),'service role can settle verified Paystack transfers');
select has_trigger('public','paystack_refunds','paystack_refund_status_notification','refund status updates are notified and audited');

select * from finish();
rollback;
