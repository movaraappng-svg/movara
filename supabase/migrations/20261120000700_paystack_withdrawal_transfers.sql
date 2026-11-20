-- Paystack bank transfers settle wallet withdrawals through verified webhooks or provider checks.
alter table public.wallet_withdrawals drop constraint if exists wallet_withdrawals_status_check;
alter table public.wallet_withdrawals add constraint wallet_withdrawals_status_check
  check(status in ('requested','processing','paid','rejected','failed','reversed'));
alter table public.wallet_withdrawals add column if not exists provider_event_id text;
alter table public.wallet_withdrawals add column if not exists provider text;
update public.wallet_withdrawals set provider='manual' where status in ('processing','paid') and provider is null;
create unique index wallet_withdrawals_provider_reference_uq on public.wallet_withdrawals(provider_reference) where provider_reference is not null;
grant select,insert,update on public.wallet_withdrawals,public.wallet_transactions to movara_workflow_owner;
grant movara_workflow_owner to postgres with set true, inherit false;
grant create on schema public to movara_workflow_owner;

drop function public.admin_wallet_withdrawal_queue();
create function public.admin_wallet_withdrawal_queue()
returns table(id uuid,user_id uuid,amount_kobo bigint,bank_code text,account_number text,account_name text,status text,created_at timestamptz,admin_note text,provider text,provider_reference text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.has_role('administrator') then raise exception 'Administrator access required' using errcode='42501'; end if;
  return query select w.id,w.user_id,w.amount_kobo,w.bank_code,w.account_number,w.account_name,w.status,w.created_at,w.admin_note,w.provider,w.provider_reference
    from public.wallet_withdrawals w where w.status in ('requested','processing') order by w.created_at;
end;
$$;
alter function public.admin_wallet_withdrawal_queue() owner to movara_workflow_owner;
revoke all on function public.admin_wallet_withdrawal_queue() from public,anon;
grant execute on function public.admin_wallet_withdrawal_queue() to authenticated;

create function public.admin_finalize_legacy_withdrawal(p_id uuid,p_status text,p_provider_reference text,p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid();v_row public.wallet_withdrawals%rowtype;
begin
  if v_actor is null or not private.has_role('administrator') then raise exception 'Administrator access required' using errcode='42501'; end if;
  select * into v_row from public.wallet_withdrawals where id=p_id for update;
  if not found or v_row.status<>'processing' or v_row.provider is distinct from 'manual' or p_status not in ('paid','failed') then
    raise exception 'This legacy payout cannot be updated with this action' using errcode='22023';
  end if;
  if p_status='paid' and length(btrim(coalesce(p_provider_reference,''))) not between 2 and 120 then
    raise exception 'Record the bank transfer reference before marking this payout paid' using errcode='22023';
  end if;
  update public.wallet_withdrawals set status=p_status,provider_reference=case when p_status='paid' then btrim(p_provider_reference) else provider_reference end,
    admin_note=nullif(btrim(coalesce(p_note,'')),''),updated_at=pg_catalog.now(),processed_at=pg_catalog.now() where id=p_id;
  if p_status='failed' then
    insert into public.wallet_transactions(wallet_id,user_id,amount_kobo,entry_type,reference,memo)
      values(v_row.wallet_id,v_row.user_id,v_row.amount_kobo,'withdrawal_release','withdrawal-release:'||v_row.id::text,'Failed legacy transfer reserve returned') on conflict(user_id,reference) do nothing;
  end if;
  perform private.write_audit(v_actor,'legacy_withdrawal_manually_settled','wallet_withdrawal',p_id,
    pg_catalog.jsonb_build_object('from','processing','to',p_status,'reference',p_provider_reference,'note',p_note));
end;
$$;
alter function public.admin_finalize_legacy_withdrawal(uuid,text,text,text) owner to movara_workflow_owner;
revoke all on function public.admin_finalize_legacy_withdrawal(uuid,text,text,text) from public,anon;
grant execute on function public.admin_finalize_legacy_withdrawal(uuid,text,text,text) to authenticated;

create function public.wallet_finalize_transfer(p_provider_reference text,p_provider_status text,p_event_id text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_row public.wallet_withdrawals%rowtype; v_status text; v_final text;
begin
  if p_provider_status not in ('success','failed','reversed') or length(btrim(coalesce(p_provider_reference,''))) not between 16 and 120 then
    raise exception 'Transfer result is invalid' using errcode='22023';
  end if;
  v_final:=case when p_provider_status='success' then 'paid' else p_provider_status end;
  select * into v_row from public.wallet_withdrawals where provider_reference=p_provider_reference and provider='paystack' for update;
  if not found then return false; end if;
  if v_row.status=v_final then return true; end if;
  if v_row.status not in ('processing','paid') or (v_row.status='paid' and p_provider_status<>'reversed') then return false; end if;
  update public.wallet_withdrawals set status=v_final,provider_event_id=coalesce(p_event_id,provider_event_id),updated_at=pg_catalog.now(),
    processed_at=case when v_final in ('paid','failed','reversed') then pg_catalog.now() else processed_at end,
    admin_note=case when v_final='reversed' then 'Paystack reversed the transfer; reserved funds were returned.' else admin_note end
    where id=v_row.id;
  if v_final in ('failed','reversed') then
    insert into public.wallet_transactions(wallet_id,user_id,amount_kobo,entry_type,reference,memo)
      values(v_row.wallet_id,v_row.user_id,v_row.amount_kobo,'withdrawal_release','withdrawal-release:'||v_row.id::text,'Failed or reversed Paystack payout returned')
      on conflict(user_id,reference) do nothing;
  end if;
  insert into public.notifications(user_id,kind,payload,event_key)
    values(v_row.user_id,'wallet_transaction',pg_catalog.jsonb_build_object('withdrawal_id',v_row.id,'status',v_final),'withdrawal:'||v_row.id::text||':'||v_final)
    on conflict do nothing;
  perform private.write_audit(null,'wallet_withdrawal_provider_settled','wallet_withdrawal',v_row.id,
    pg_catalog.jsonb_build_object('from',v_row.status,'to',v_final,'provider_reference',p_provider_reference,'provider_event_id',p_event_id));
  return true;
end;
$$;
alter function public.wallet_finalize_transfer(text,text,text) owner to movara_workflow_owner;
revoke all on function public.wallet_finalize_transfer(text,text,text) from public,anon,authenticated;
grant execute on function public.wallet_finalize_transfer(text,text,text) to service_role;

drop function public.admin_update_wallet_withdrawal(uuid,text,text,text);
create function public.admin_update_wallet_withdrawal(p_id uuid,p_status text,p_provider_reference text default null,p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid(); v_row public.wallet_withdrawals%rowtype;
begin
  if v_actor is null or not private.has_role('administrator') then raise exception 'Administrator access required' using errcode='42501'; end if;
  select * into v_row from public.wallet_withdrawals where id=p_id for update;
  if not found or not (v_row.status='requested' and p_status in ('processing','rejected')) then
    raise exception 'That withdrawal status change is not allowed' using errcode='22023';
  end if;
  if p_status='processing' and (length(btrim(coalesce(p_provider_reference,''))) not between 16 and 50
    or btrim(p_provider_reference) !~ '^[a-z0-9_-]+$'
    or btrim(p_provider_reference)<>'movara_wd_'||replace(v_row.id::text,'-','')) then
    raise exception 'A valid Paystack transfer reference is required' using errcode='22023'; end if;
  update public.wallet_withdrawals set status=p_status,provider_reference=coalesce(nullif(btrim(p_provider_reference),''),provider_reference),
    provider=case when p_status='processing' and v_row.status='requested' then 'paystack' else provider end,
    admin_note=nullif(btrim(coalesce(p_note,'')),''),updated_at=pg_catalog.now(),processed_at=case when p_status='rejected' then pg_catalog.now() else processed_at end where id=p_id;
  if p_status='rejected' then
    insert into public.wallet_transactions(wallet_id,user_id,amount_kobo,entry_type,reference,memo)
      values(v_row.wallet_id,v_row.user_id,v_row.amount_kobo,'withdrawal_release','withdrawal-release:'||v_row.id::text,'Withdrawal reserve returned') on conflict(user_id,reference) do nothing;
  end if;
  insert into public.notifications(user_id,kind,payload,event_key)
    values(v_row.user_id,'wallet_transaction',pg_catalog.jsonb_build_object('withdrawal_id',v_row.id,'status',p_status),'withdrawal:'||v_row.id::text||':'||p_status) on conflict do nothing;
  perform private.write_audit(v_actor,'wallet_withdrawal_status_changed','wallet_withdrawal',v_row.id,
    pg_catalog.jsonb_build_object('from',v_row.status,'to',p_status,'amount_kobo',v_row.amount_kobo));
end;
$$;
alter function public.admin_update_wallet_withdrawal(uuid,text,text,text) owner to movara_workflow_owner;
revoke create on schema public from movara_workflow_owner;

