create extension if not exists pgtap with schema extensions;
begin;
select plan(20);

select has_table('public','wallets','wallet accounts exist');
select has_table('public','wallet_transactions','wallet ledger exists');
select has_table('public','wallet_topups','wallet top ups exist');
select has_table('public','wallet_withdrawals','withdrawal requests exist');
select ok((select relrowsecurity from pg_class where oid='public.wallets'::regclass),'wallet accounts enforce RLS');
select ok((select relrowsecurity from pg_class where oid='public.wallet_transactions'::regclass),'wallet ledger enforces RLS');
select ok(not has_table_privilege('authenticated','public.wallet_transactions','INSERT'),'clients cannot write wallet ledger rows');
select ok(not has_table_privilege('anon','public.wallet_transactions','SELECT'),'anonymous users cannot inspect ledger rows');
select ok(has_function_privilege('authenticated','public.wallet_balance(uuid)','EXECUTE'),'signed-in users can read scoped wallet balances');
select ok(has_function_privilege('authenticated','public.wallet_request_topup(bigint)','EXECUTE'),'signed-in users can create a top-up intent');
select ok(has_function_privilege('authenticated','public.wallet_request_withdrawal(bigint,text,text,text)','EXECUTE'),'signed-in users can request withdrawals');
select ok(not has_function_privilege('authenticated','public.wallet_complete_topup(uuid,text)','EXECUTE'),'clients cannot credit wallet top ups');
select ok(has_function_privilege('service_role','public.wallet_complete_topup(uuid,text)','EXECUTE'),'trusted payment services can complete top ups');
select ok(not has_function_privilege('authenticated','public.wallet_create_paid_ride(uuid,text,text,double precision,double precision,double precision,double precision,text,integer,bigint,text,timestamp with time zone,text,numeric,bigint,bigint,text,text)','EXECUTE'),'clients cannot invoke trusted wallet ride creation directly');
select ok(has_function_privilege('service_role','public.wallet_create_paid_ride(uuid,text,text,double precision,double precision,double precision,double precision,text,integer,bigint,text,timestamp with time zone,text,numeric,bigint,bigint,text,text)','EXECUTE'),'validated ride service can atomically debit wallet');
select ok(has_function_privilege('authenticated','public.admin_wallet_adjustment(uuid,bigint,text,text)','EXECUTE'),'admin adjustment RPC is callable and role guarded');
select ok(not has_function_privilege('anon','public.admin_wallet_adjustment(uuid,bigint,text,text)','EXECUTE'),'anonymous users cannot adjust wallets');
select has_trigger('public','profiles','wallet_create_for_new_profile','new accounts receive a wallet');
select has_trigger('public','rides','wallet_ride_completion','completed paid rides credit driver earnings');
select has_trigger('public','payments','wallet_payment_success','settled ride payments trigger driver earnings settlement');

select * from finish();
rollback;
