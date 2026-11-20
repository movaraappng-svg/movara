-- Auditable payment reconciliation and provider-backed refunds.
create table public.paystack_refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id),
  requested_by uuid not null references public.profiles(id),
  amount_kobo bigint not null check (amount_kobo > 0),
  currency char(3) not null check (currency = 'NGN'),
  customer_reason text not null check (length(btrim(customer_reason)) between 3 and 500),
  merchant_reason text not null check (length(btrim(merchant_reason)) between 3 and 500),
  status text not null default 'requested' check (status in ('requested','submitting','pending','processing','processed','failed','rejected')),
  provider_reference text not null unique,
  provider_refund_id text,
  provider_status text,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  processed_at timestamptz
);
create index paystack_refunds_payment_idx on public.paystack_refunds(payment_id,created_at desc);

create table public.payment_reconciliation_runs (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid not null references public.profiles(id),
  status text not null default 'running' check(status in ('running','completed','partial','failed')),
  checked_count integer not null default 0 check(checked_count>=0),
  mismatch_count integer not null default 0 check(mismatch_count>=0),
  error_summary text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);
create table public.payment_reconciliation_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.payment_reconciliation_runs(id) on delete cascade,
  payment_id uuid not null references public.payments(id),
  expected_status text not null,
  provider_status text,
  expected_amount_kobo bigint not null,
  provider_amount_kobo bigint,
  provider_currency char(3),
  matches boolean not null,
  detail text,
  checked_at timestamptz not null default now(),
  unique(run_id,payment_id)
);
create index payment_reconciliation_recent_idx on public.payment_reconciliation_runs(started_at desc);

alter table public.paystack_refunds enable row level security;
alter table public.payment_reconciliation_runs enable row level security;
alter table public.payment_reconciliation_items enable row level security;
revoke all on public.paystack_refunds,public.payment_reconciliation_runs,public.payment_reconciliation_items from anon,authenticated;
grant select on public.paystack_refunds,public.payment_reconciliation_runs,public.payment_reconciliation_items to authenticated;
create policy finance_refunds_admin_read on public.paystack_refunds for select to authenticated using ((select private.has_role('administrator')) or requested_by=(select auth.uid()));
create policy finance_reconciliation_admin_read on public.payment_reconciliation_runs for select to authenticated using ((select private.has_role('administrator')));
create policy finance_reconciliation_items_admin_read on public.payment_reconciliation_items for select to authenticated using ((select private.has_role('administrator')));

grant select,insert,update on public.paystack_refunds to movara_workflow_owner;
create policy workflow_paystack_refunds on public.paystack_refunds for all to movara_workflow_owner using(true) with check(true);
grant execute on function private.write_audit(uuid,text,text,uuid,jsonb) to movara_workflow_owner;
grant movara_workflow_owner to postgres with set true, inherit false;
grant create on schema public to movara_workflow_owner;
grant usage on schema auth,public,private to movara_workflow_owner;
grant execute on function auth.uid() to movara_workflow_owner;
set role movara_workflow_owner;

create function public.admin_request_paystack_refund(
  p_payment_id uuid,p_amount_kobo bigint,p_customer_reason text,p_merchant_reason text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid(); v_payment public.payments%rowtype; v_reserved bigint; v_id uuid:=gen_random_uuid();
begin
  if v_actor is null or not private.has_role('administrator') then raise exception 'Administrator access required' using errcode='42501'; end if;
  if p_amount_kobo<=0 or length(btrim(coalesce(p_customer_reason,''))) not between 3 and 500
    or length(btrim(coalesce(p_merchant_reason,''))) not between 3 and 500 then raise exception 'Refund details are invalid' using errcode='22023'; end if;
  select * into v_payment from public.payments where id=p_payment_id for update;
  if not found or v_payment.status<>'succeeded' or v_payment.provider<>'paystack' or v_payment.currency<>'NGN'
    or v_payment.provider_reference is null then raise exception 'Only verified Paystack payments can be refunded' using errcode='22023'; end if;
  select coalesce(sum(amount_kobo),0) into v_reserved from public.paystack_refunds
    where payment_id=p_payment_id and status in ('requested','submitting','pending','processing','processed');
  if p_amount_kobo>v_payment.amount_kobo-v_reserved then raise exception 'Refund exceeds the remaining refundable amount' using errcode='22023'; end if;
  insert into public.paystack_refunds(id,payment_id,requested_by,amount_kobo,currency,customer_reason,merchant_reason,provider_reference)
  values(v_id,p_payment_id,v_actor,p_amount_kobo,v_payment.currency,btrim(p_customer_reason),btrim(p_merchant_reason),'movara_rf_'||replace(v_id::text,'-',''));
  perform private.write_audit(v_actor,'paystack_refund_requested','paystack_refund',v_id,
    pg_catalog.jsonb_build_object('payment_id',p_payment_id,'amount_kobo',p_amount_kobo,'reason',p_merchant_reason));
  return v_id;
end;
$$;
reset role;
revoke movara_workflow_owner from postgres;
revoke create on schema public from movara_workflow_owner;
alter function public.admin_request_paystack_refund(uuid,bigint,text,text) owner to movara_workflow_owner;
revoke all on function public.admin_request_paystack_refund(uuid,bigint,text,text) from public,anon;
grant execute on function public.admin_request_paystack_refund(uuid,bigint,text,text) to authenticated;

create function private.notify_paystack_refund_status()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_user uuid;v_kind text;
begin
  if new.status is not distinct from old.status then return new; end if;
  select p.payer_id into v_user from public.payments p where p.id=new.payment_id;
  if v_user is null then return new; end if;
  v_kind:=case when new.status='processed' then 'refund_approved' else 'wallet_transaction' end;
  if not exists(select 1 from public.notification_preferences n where n.user_id=v_user
    and n.kind in ('all',v_kind) and n.channel='in_app' and not n.enabled) then
    insert into public.notifications(user_id,kind,payload,event_key)
      values(v_user,v_kind,pg_catalog.jsonb_build_object('refund_id',new.id,'amount_kobo',new.amount_kobo,'status',new.status),
        'paystack-refund:'||new.id::text||':'||new.status) on conflict do nothing;
  end if;
  perform private.write_audit(null,'paystack_refund_status_changed','paystack_refund',new.id,
    pg_catalog.jsonb_build_object('from',old.status,'to',new.status,'provider_reference',new.provider_reference));
  return new;
end;
$$;
grant create on schema private to movara_workflow_owner;
alter function private.notify_paystack_refund_status() owner to movara_workflow_owner;
revoke create on schema private from movara_workflow_owner;
revoke all on function private.notify_paystack_refund_status() from public,anon,authenticated;
grant execute on function private.notify_paystack_refund_status() to movara_workflow_owner;
create trigger paystack_refund_status_notification after update of status on public.paystack_refunds
  for each row execute function private.notify_paystack_refund_status();

