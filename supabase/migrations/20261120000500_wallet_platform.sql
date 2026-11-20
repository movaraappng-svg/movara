-- Transaction based NGN wallets. Balances are derived from the immutable ledger.
alter table public.payments drop constraint if exists payments_payment_type_check;
alter table public.payments add constraint payments_payment_type_check
  check (payment_type in ('ride','cancellation_fee','wallet_topup'));
alter table public.rides drop constraint if exists rides_payment_method_valid;
alter table public.rides add constraint rides_payment_method_valid check(payment_method in ('cash','paystack','wallet'));

create table public.wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  currency char(3) not null default 'NGN' check(currency='NGN'),
  status text not null default 'active' check(status in ('active','frozen','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.wallets(id),
  user_id uuid not null references public.profiles(id),
  amount_kobo bigint not null check(amount_kobo<>0),
  entry_type text not null check(entry_type in ('wallet_topup','ride_debit','ride_refund','ride_earning','referral_credit','promo_credit','refund_credit','withdrawal_hold','withdrawal_release','admin_adjustment')),
  reference text not null,
  memo text not null check(length(memo) between 1 and 240),
  created_at timestamptz not null default now(),
  unique(user_id,reference),
  check((entry_type in ('wallet_topup','ride_refund','ride_earning','referral_credit','promo_credit','refund_credit','withdrawal_release') and amount_kobo>0)
    or (entry_type in ('ride_debit','withdrawal_hold') and amount_kobo<0) or entry_type='admin_adjustment')
);
create index wallet_transactions_recent_idx on public.wallet_transactions(user_id,created_at desc);

create table public.wallet_topups (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.wallets(id),
  user_id uuid not null references public.profiles(id),
  payment_id uuid not null unique references public.payments(id),
  amount_kobo bigint not null check(amount_kobo between 50000 and 100000000),
  status text not null default 'pending' check(status in ('pending','succeeded','failed')),
  checkout_url text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index wallet_topups_user_recent_idx on public.wallet_topups(user_id,created_at desc);

create table public.wallet_withdrawals (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.wallets(id),
  user_id uuid not null references public.profiles(id),
  amount_kobo bigint not null check(amount_kobo between 100000 and 500000000),
  bank_code text not null check(bank_code ~ '^[A-Za-z0-9_-]{2,20}$'),
  account_number text not null check(account_number ~ '^[0-9]{10}$'),
  account_name text not null check(length(btrim(account_name)) between 2 and 120),
  status text not null default 'requested' check(status in ('requested','processing','paid','rejected','failed')),
  provider_reference text,
  admin_note text check(admin_note is null or length(admin_note)<=1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  processed_at timestamptz
);
create index wallet_withdrawals_queue_idx on public.wallet_withdrawals(status,created_at) where status in ('requested','processing');

alter table public.wallets enable row level security;
alter table public.wallet_transactions enable row level security;
alter table public.wallet_topups enable row level security;
alter table public.wallet_withdrawals enable row level security;
revoke all on public.wallets,public.wallet_transactions,public.wallet_topups,public.wallet_withdrawals from anon,authenticated;
grant select on public.wallets,public.wallet_transactions,public.wallet_topups,public.wallet_withdrawals to authenticated;
create policy wallets_read_own on public.wallets for select to authenticated using(user_id=(select auth.uid()));
create policy wallet_transactions_read_own on public.wallet_transactions for select to authenticated using(user_id=(select auth.uid()));
create policy wallet_topups_read_own on public.wallet_topups for select to authenticated using(user_id=(select auth.uid()));
create policy wallet_withdrawals_read_own on public.wallet_withdrawals for select to authenticated using(user_id=(select auth.uid()));

grant select,insert,update on public.wallets,public.wallet_transactions,public.wallet_topups,public.wallet_withdrawals,public.payments to movara_workflow_owner;
grant select,insert,update on public.rides to movara_workflow_owner;
create policy workflow_wallet_rides on public.rides for all to movara_workflow_owner using(true) with check(true);
create policy workflow_wallets on public.wallets for all to movara_workflow_owner using(true) with check(true);
create policy workflow_wallet_transactions on public.wallet_transactions for all to movara_workflow_owner using(true) with check(true);
create policy workflow_wallet_topups on public.wallet_topups for all to movara_workflow_owner using(true) with check(true);
create policy workflow_wallet_withdrawals on public.wallet_withdrawals for all to movara_workflow_owner using(true) with check(true);

insert into public.wallets(user_id)
select id from public.profiles on conflict(user_id) do nothing;

grant movara_workflow_owner to postgres with set true, inherit false;
grant create on schema public,private to movara_workflow_owner;
grant usage on schema auth,public,private to movara_workflow_owner;
grant execute on function auth.uid() to movara_workflow_owner;
set role movara_workflow_owner;

create function public.wallet_balance(p_user_id uuid default null)
returns bigint language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid:=coalesce(p_user_id,auth.uid()); v_balance bigint;
begin
  if v_user is null or (v_user<>auth.uid() and not private.has_role('administrator')) then
    raise exception 'Wallet access denied' using errcode='42501';
  end if;
  select coalesce(sum(t.amount_kobo),0)::bigint into v_balance
    from public.wallet_transactions t where t.user_id=v_user;
  return v_balance;
end;
$$;

create function private.wallet_create_for_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.wallets(user_id) values(new.id) on conflict(user_id) do nothing;
  return new;
end;
$$;

create function public.wallet_request_topup(p_amount_kobo bigint)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid:=auth.uid(); v_wallet public.wallets%rowtype; v_payment uuid; v_topup uuid;
begin
  if v_user is null or p_amount_kobo not between 50000 and 100000000 then
    raise exception 'Top up amount must be between ₦500 and ₦1,000,000' using errcode='22023';
  end if;
  select * into v_wallet from public.wallets where user_id=v_user for update;
  if not found or v_wallet.status<>'active' then raise exception 'Wallet is unavailable' using errcode='42501'; end if;
  insert into public.payments(payer_id,amount_kobo,currency,status,provider,payment_type)
    values(v_user,p_amount_kobo,'NGN','pending','paystack','wallet_topup') returning id into v_payment;
  insert into public.wallet_topups(wallet_id,user_id,payment_id,amount_kobo)
    values(v_wallet.id,v_user,v_payment,p_amount_kobo) returning id into v_topup;
  return v_topup;
end;
$$;

create function public.wallet_create_paid_ride(
  p_user_id uuid,p_pickup_label text,p_destination_label text,p_pickup_latitude double precision,p_pickup_longitude double precision,
  p_destination_latitude double precision,p_destination_longitude double precision,p_service_level text,p_passenger_count integer,
  p_fare_kobo bigint,p_city_code text,p_scheduled_for timestamptz,p_special_instructions text,p_surge_multiplier numeric,
  p_airport_surcharge_kobo bigint,p_promotion_discount_kobo bigint,p_promo_code text,p_corporate_code text
)
returns table(id uuid,status public.ride_status,estimated_fare_ngn_kobo bigint,created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare v_wallet public.wallets%rowtype; v_balance bigint; v_ride public.rides%rowtype;
begin
  if not exists(select 1 from public.user_roles where user_id=p_user_id and role='customer')
    or length(btrim(coalesce(p_pickup_label,''))) not between 1 and 300
    or length(btrim(coalesce(p_destination_label,''))) not between 1 and 300
    or p_pickup_latitude not between -90 and 90 or p_destination_latitude not between -90 and 90
    or p_pickup_longitude not between -180 and 180 or p_destination_longitude not between -180 and 180
    or p_service_level not in ('economy','comfort','xl','executive') or p_passenger_count not between 1 and 20
    or p_fare_kobo<=0 or p_city_code !~ '^[A-Z0-9-]{2,24}$' or p_surge_multiplier not between 1 and 3
    or p_airport_surcharge_kobo<0 or p_promotion_discount_kobo<0 then
    raise exception 'Wallet ride details are invalid' using errcode='22023';
  end if;
  select * into v_wallet from public.wallets where user_id=p_user_id for update;
  if not found or v_wallet.status<>'active' then raise exception 'Wallet is unavailable' using errcode='42501'; end if;
  select coalesce(sum(amount_kobo),0)::bigint into v_balance from public.wallet_transactions where wallet_id=v_wallet.id;
  if v_balance<p_fare_kobo then raise exception 'Wallet balance is too low' using errcode='22023'; end if;
  insert into public.rides(customer_id,pickup_label,destination_label,pickup_latitude,pickup_longitude,
    destination_latitude,destination_longitude,service_level,passenger_count,estimated_fare_ngn_kobo,currency,
    scheduled_for,special_instructions,payment_method,status,city_code,surge_multiplier,airport_surcharge_ngn_kobo,
    promotion_discount_ngn_kobo,promo_code,corporate_code)
  values(p_user_id,btrim(p_pickup_label),btrim(p_destination_label),p_pickup_latitude,p_pickup_longitude,
    p_destination_latitude,p_destination_longitude,p_service_level,p_passenger_count,p_fare_kobo,'NGN',
    p_scheduled_for,nullif(btrim(coalesce(p_special_instructions,'')),''),'wallet','requested',p_city_code,
    p_surge_multiplier,p_airport_surcharge_kobo,p_promotion_discount_kobo,nullif(p_promo_code,''),nullif(p_corporate_code,''))
  returning * into v_ride;
  insert into public.wallet_transactions(wallet_id,user_id,amount_kobo,entry_type,reference,memo)
    values(v_wallet.id,p_user_id,-p_fare_kobo,'ride_debit','ride-debit:'||v_ride.id::text,'Wallet payment for ride');
  return query select v_ride.id,v_ride.status,v_ride.estimated_fare_ngn_kobo,v_ride.created_at;
end;
$$;

create function public.wallet_topup_checkout(p_topup_id uuid)
returns table(payment_id uuid,amount_kobo bigint,provider_reference text,checkout_url text)
language plpgsql stable security definer set search_path = '' as $$
begin
  return query select p.id,p.amount_kobo,p.provider_reference,t.checkout_url
    from public.wallet_topups t join public.payments p on p.id=t.payment_id
    where t.id=p_topup_id and t.user_id=auth.uid() and t.status='pending' and p.status='pending';
end;
$$;

create function public.wallet_complete_topup(p_payment_id uuid,p_event_id text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_payment public.payments%rowtype; v_topup public.wallet_topups%rowtype;
begin
  select * into v_payment from public.payments where id=p_payment_id and payment_type='wallet_topup' for update;
  if not found then raise exception 'Wallet payment not found' using errcode='22023'; end if;
  select * into v_topup from public.wallet_topups where payment_id=p_payment_id for update;
  if not found or v_topup.amount_kobo<>v_payment.amount_kobo then raise exception 'Wallet top up does not match payment' using errcode='22023'; end if;
  if v_payment.status='succeeded' and v_topup.status='succeeded' then return true; end if;
  if v_payment.status<>'pending' or v_topup.status<>'pending' then return false; end if;
  update public.payments set status='succeeded',provider_event_id=coalesce(p_event_id,provider_event_id),updated_at=pg_catalog.now() where id=p_payment_id;
  update public.wallet_topups set status='succeeded',completed_at=pg_catalog.now() where id=v_topup.id;
  insert into public.wallet_transactions(wallet_id,user_id,amount_kobo,entry_type,reference,memo)
    values(v_topup.wallet_id,v_topup.user_id,v_topup.amount_kobo,'wallet_topup','topup:'||v_topup.id::text,'Wallet top up') on conflict(user_id,reference) do nothing;
  insert into public.notifications(user_id,kind,payload,event_key)
    values(v_topup.user_id,'wallet_transaction',pg_catalog.jsonb_build_object('amount_kobo',v_topup.amount_kobo,'direction','credit'),'wallet-topup:'||v_topup.id::text) on conflict do nothing;
  return true;
end;
$$;

create function public.wallet_fail_topup(p_payment_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_topup public.wallet_topups%rowtype; v_status text;
begin
  select * into v_topup from public.wallet_topups where payment_id=p_payment_id for update;
  if not found then return false; end if;
  select status::text into v_status from public.payments where id=p_payment_id and payment_type='wallet_topup' for update;
  if v_status is null or v_topup.status='succeeded' or v_status='succeeded' then return true; end if;
  if v_topup.status='failed' and v_status='failed' then return true; end if;
  if v_topup.status='pending' and v_status='pending' then
    update public.payments set status='failed',updated_at=pg_catalog.now() where id=p_payment_id;
    update public.wallet_topups set status='failed' where id=v_topup.id;
    return true;
  end if;
  return false;
end;
$$;

create function public.wallet_request_withdrawal(p_amount_kobo bigint,p_bank_code text,p_account_number text,p_account_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid:=auth.uid(); v_wallet public.wallets%rowtype; v_balance bigint; v_id uuid;
begin
  if v_user is null or p_amount_kobo not between 100000 and 500000000
    or p_bank_code !~ '^[A-Za-z0-9_-]{2,20}$' or p_account_number !~ '^[0-9]{10}$'
    or length(btrim(coalesce(p_account_name,''))) not between 2 and 120 then
    raise exception 'Withdrawal details are invalid' using errcode='22023';
  end if;
  select * into v_wallet from public.wallets where user_id=v_user for update;
  if not found or v_wallet.status<>'active' then raise exception 'Wallet is unavailable' using errcode='42501'; end if;
  select coalesce(sum(amount_kobo),0)::bigint into v_balance from public.wallet_transactions where wallet_id=v_wallet.id;
  if v_balance<p_amount_kobo then raise exception 'Wallet balance is too low' using errcode='22023'; end if;
  insert into public.wallet_withdrawals(wallet_id,user_id,amount_kobo,bank_code,account_number,account_name)
    values(v_wallet.id,v_user,p_amount_kobo,p_bank_code,p_account_number,btrim(p_account_name)) returning id into v_id;
  insert into public.wallet_transactions(wallet_id,user_id,amount_kobo,entry_type,reference,memo)
    values(v_wallet.id,v_user,-p_amount_kobo,'withdrawal_hold','withdrawal-hold:'||v_id::text,'Withdrawal requested');
  return v_id;
end;
$$;

create function public.admin_wallet_withdrawal_queue()
returns table(id uuid,user_id uuid,amount_kobo bigint,bank_code text,account_number text,account_name text,status text,created_at timestamptz,admin_note text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.has_role('administrator') then raise exception 'Administrator access required' using errcode='42501'; end if;
  return query select w.id,w.user_id,w.amount_kobo,w.bank_code,w.account_number,w.account_name,w.status,w.created_at,w.admin_note
    from public.wallet_withdrawals w where w.status in ('requested','processing') order by w.created_at;
end;
$$;

create function public.admin_update_wallet_withdrawal(p_id uuid,p_status text,p_provider_reference text default null,p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid(); v_row public.wallet_withdrawals%rowtype;
begin
  if v_actor is null or not private.has_role('administrator') then raise exception 'Administrator access required' using errcode='42501'; end if;
  select * into v_row from public.wallet_withdrawals where id=p_id for update;
  if not found or not ((v_row.status='requested' and p_status in ('processing','rejected')) or (v_row.status='processing' and p_status in ('paid','failed'))) then
    raise exception 'That withdrawal status change is not allowed' using errcode='22023';
  end if;
  if p_status='paid' and length(btrim(coalesce(p_provider_reference,''))) not between 2 and 120 then
    raise exception 'A payout reference is required' using errcode='22023';
  end if;
  update public.wallet_withdrawals set status=p_status,provider_reference=coalesce(nullif(btrim(p_provider_reference),''),provider_reference),
    admin_note=nullif(btrim(coalesce(p_note,'')),''),updated_at=pg_catalog.now(),processed_at=case when p_status in ('paid','rejected','failed') then pg_catalog.now() else processed_at end where id=p_id;
  if p_status in ('rejected','failed') then
    insert into public.wallet_transactions(wallet_id,user_id,amount_kobo,entry_type,reference,memo)
      values(v_row.wallet_id,v_row.user_id,v_row.amount_kobo,'withdrawal_release','withdrawal-release:'||v_row.id::text,'Withdrawal funds returned') on conflict(user_id,reference) do nothing;
  end if;
  insert into public.notifications(user_id,kind,payload,event_key)
    values(v_row.user_id,'wallet_transaction',pg_catalog.jsonb_build_object('withdrawal_id',v_row.id,'status',p_status),'withdrawal:'||v_row.id::text||':'||p_status) on conflict do nothing;
  perform private.write_audit(v_actor,'wallet_withdrawal_status_changed','wallet_withdrawal',v_row.id,
    pg_catalog.jsonb_build_object('from',v_row.status,'to',p_status,'amount_kobo',v_row.amount_kobo));
end;
$$;

create function public.admin_wallet_adjustment(p_user_id uuid,p_amount_kobo bigint,p_entry_type text,p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid(); v_wallet public.wallets%rowtype; v_balance bigint; v_id uuid:=gen_random_uuid();
begin
  if v_actor is null or not private.has_role('administrator') then raise exception 'Administrator access required' using errcode='42501'; end if;
  if p_amount_kobo=0 or p_entry_type not in ('referral_credit','promo_credit','refund_credit','admin_adjustment')
    or (p_amount_kobo<0 and p_entry_type<>'admin_adjustment')
    or length(btrim(coalesce(p_reason,''))) not between 3 and 240 then raise exception 'Wallet adjustment is invalid' using errcode='22023'; end if;
  select * into v_wallet from public.wallets where user_id=p_user_id for update;
  if not found or v_wallet.status<>'active' then raise exception 'Wallet is unavailable' using errcode='22023'; end if;
  select coalesce(sum(amount_kobo),0)::bigint into v_balance from public.wallet_transactions where wallet_id=v_wallet.id;
  if p_amount_kobo<0 and v_balance < -p_amount_kobo then raise exception 'Wallet balance is too low' using errcode='22023'; end if;
  insert into public.wallet_transactions(wallet_id,user_id,amount_kobo,entry_type,reference,memo)
    values(v_wallet.id,p_user_id,p_amount_kobo,p_entry_type,'admin-adjustment:'||v_id::text,btrim(p_reason)) returning id into v_id;
  insert into public.notifications(user_id,kind,payload,event_key)
    values(p_user_id,'wallet_transaction',pg_catalog.jsonb_build_object('amount_kobo',p_amount_kobo,'direction',case when p_amount_kobo>0 then 'credit' else 'debit' end),'wallet-adjustment:'||v_id::text) on conflict do nothing;
  perform private.write_audit(v_actor,'wallet_adjustment_created','wallet_transaction',v_id,
    pg_catalog.jsonb_build_object('user_id',p_user_id,'amount_kobo',p_amount_kobo,'entry_type',p_entry_type,'reason',p_reason));
  return v_id;
end;
$$;

create function private.wallet_settle_driver_earning(p_ride_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_ride public.rides%rowtype;
begin
  select * into v_ride from public.rides where id=p_ride_id for update;
  if not found or v_ride.status<>'completed' or v_ride.driver_id is null or coalesce(v_ride.driver_earnings_ngn_kobo,0)<=0
    or not (exists(select 1 from public.payments p where p.ride_id=v_ride.id and p.payment_type='ride' and p.status='succeeded')
      or (v_ride.payment_method='wallet' and exists(select 1 from public.wallet_transactions t where t.user_id=v_ride.customer_id and t.reference='ride-debit:'||v_ride.id::text))) then return; end if;
  insert into public.wallets(user_id) values(v_ride.driver_id) on conflict(user_id) do nothing;
  insert into public.wallet_transactions(wallet_id,user_id,amount_kobo,entry_type,reference,memo)
    select w.id,w.user_id,v_ride.driver_earnings_ngn_kobo,'ride_earning','ride-earning:'||v_ride.id::text,'Earnings from completed online ride'
      from public.wallets w where w.user_id=v_ride.driver_id on conflict(user_id,reference) do nothing;
  insert into public.notifications(user_id,kind,payload,event_key)
    values(v_ride.driver_id,'wallet_transaction',pg_catalog.jsonb_build_object('amount_kobo',v_ride.driver_earnings_ngn_kobo,'direction','credit','ride_id',v_ride.id),'ride-earning:'||v_ride.id::text) on conflict do nothing;
end;
$$;

create function private.wallet_ride_completion_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status='completed' and old.status is distinct from new.status then perform private.wallet_settle_driver_earning(new.id); end if;
  if new.status='cancelled' and old.status is distinct from new.status and new.payment_method='wallet'
    and exists(select 1 from public.wallet_transactions t where t.user_id=new.customer_id and t.reference='ride-debit:'||new.id::text) then
    insert into public.wallet_transactions(wallet_id,user_id,amount_kobo,entry_type,reference,memo)
      select w.id,w.user_id,greatest(0,new.estimated_fare_ngn_kobo-coalesce(new.cancellation_fee_ngn_kobo,0)),
        'ride_refund','ride-refund:'||new.id::text,'Cancelled ride wallet refund'
      from public.wallets w where w.user_id=new.customer_id
      and greatest(0,new.estimated_fare_ngn_kobo-coalesce(new.cancellation_fee_ngn_kobo,0))>0
      on conflict(user_id,reference) do nothing;
    if new.estimated_fare_ngn_kobo>coalesce(new.cancellation_fee_ngn_kobo,0) then
      insert into public.notifications(user_id,kind,payload,event_key)
        values(new.customer_id,'wallet_transaction',pg_catalog.jsonb_build_object('ride_id',new.id,'direction','credit'),'ride-refund:'||new.id::text) on conflict do nothing;
    end if;
  end if;
  return new;
end;
$$;
create function private.wallet_payment_success_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status='succeeded' and old.status is distinct from new.status and new.payment_type='ride' and new.ride_id is not null then
    perform private.wallet_settle_driver_earning(new.ride_id);
  end if;
  return new;
end;
$$;

reset role;
revoke movara_workflow_owner from postgres;
revoke create on schema public,private from movara_workflow_owner;
alter function public.wallet_balance(uuid) owner to movara_workflow_owner;
alter function public.wallet_request_topup(bigint) owner to movara_workflow_owner;
alter function public.wallet_create_paid_ride(uuid,text,text,double precision,double precision,double precision,double precision,text,integer,bigint,text,timestamptz,text,numeric,bigint,bigint,text,text) owner to movara_workflow_owner;
alter function public.wallet_topup_checkout(uuid) owner to movara_workflow_owner;
alter function public.wallet_complete_topup(uuid,text) owner to movara_workflow_owner;
alter function public.wallet_fail_topup(uuid) owner to movara_workflow_owner;
alter function public.wallet_request_withdrawal(bigint,text,text,text) owner to movara_workflow_owner;
alter function public.admin_wallet_withdrawal_queue() owner to movara_workflow_owner;
alter function public.admin_update_wallet_withdrawal(uuid,text,text,text) owner to movara_workflow_owner;
alter function public.admin_wallet_adjustment(uuid,bigint,text,text) owner to movara_workflow_owner;
alter function private.wallet_settle_driver_earning(uuid) owner to movara_workflow_owner;
alter function private.wallet_ride_completion_trigger() owner to movara_workflow_owner;
alter function private.wallet_payment_success_trigger() owner to movara_workflow_owner;
alter function private.wallet_create_for_profile() owner to movara_workflow_owner;
create trigger wallet_create_for_new_profile after insert on public.profiles for each row execute function private.wallet_create_for_profile();
create trigger wallet_ride_completion after update of status on public.rides for each row execute function private.wallet_ride_completion_trigger();
create trigger wallet_payment_success after update of status on public.payments for each row execute function private.wallet_payment_success_trigger();

revoke all on function public.wallet_balance(uuid),public.wallet_request_topup(bigint),public.wallet_topup_checkout(uuid),public.wallet_request_withdrawal(bigint,text,text,text),public.admin_wallet_withdrawal_queue(),public.admin_update_wallet_withdrawal(uuid,text,text,text),public.admin_wallet_adjustment(uuid,bigint,text,text),public.wallet_create_paid_ride(uuid,text,text,double precision,double precision,double precision,double precision,text,integer,bigint,text,timestamptz,text,numeric,bigint,bigint,text,text) from public,anon;
grant execute on function public.wallet_balance(uuid),public.wallet_request_topup(bigint),public.wallet_topup_checkout(uuid),public.wallet_request_withdrawal(bigint,text,text,text) to authenticated;
grant execute on function public.admin_wallet_withdrawal_queue(),public.admin_update_wallet_withdrawal(uuid,text,text,text),public.admin_wallet_adjustment(uuid,bigint,text,text) to authenticated;
grant execute on function public.wallet_create_paid_ride(uuid,text,text,double precision,double precision,double precision,double precision,text,integer,bigint,text,timestamptz,text,numeric,bigint,bigint,text,text) to service_role;
revoke all on function public.wallet_complete_topup(uuid,text),public.wallet_fail_topup(uuid) from public,anon,authenticated;
grant execute on function public.wallet_complete_topup(uuid,text),public.wallet_fail_topup(uuid) to service_role;
revoke all on function private.wallet_settle_driver_earning(uuid),private.wallet_ride_completion_trigger(),private.wallet_payment_success_trigger(),private.wallet_create_for_profile() from public,anon,authenticated;
grant execute on function private.wallet_settle_driver_earning(uuid),private.wallet_ride_completion_trigger(),private.wallet_payment_success_trigger(),private.wallet_create_for_profile() to movara_workflow_owner;

do $$ begin
  if not exists(select 1 from pg_catalog.pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='wallet_transactions') then
    alter publication supabase_realtime add table public.wallet_transactions;
  end if;
end $$;
