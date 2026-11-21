-- Customer cargo bookings, auditable operations, courier status updates, and Paystack settlement.
create table public.cargo_orders (
  id uuid primary key default gen_random_uuid(),
  tracking_code text not null unique default ('MV-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  sender_id uuid not null references public.profiles(id),
  recipient_name text not null check (length(btrim(recipient_name)) between 2 and 120),
  recipient_phone text not null check (length(btrim(recipient_phone)) between 7 and 32),
  service_type text not null check (service_type in ('documents','parcel','food','home_move','business_cargo')),
  package_size text not null check (package_size in ('small','medium','large')),
  package_count smallint not null check (package_count between 1 and 100),
  weight_kg numeric(8,2) not null check (weight_kg > 0 and weight_kg <= 10000),
  declared_value_ngn_kobo bigint not null default 0 check (declared_value_ngn_kobo between 0 and 10000000000),
  fragile boolean not null default false,
  pickup_label text not null check (length(btrim(pickup_label)) between 5 and 300),
  pickup_city text not null check (length(btrim(pickup_city)) between 2 and 100),
  pickup_region text not null check (length(btrim(pickup_region)) between 2 and 100),
  destination_label text not null check (length(btrim(destination_label)) between 5 and 300),
  destination_city text not null check (length(btrim(destination_city)) between 2 and 100),
  destination_region text not null check (length(btrim(destination_region)) between 2 and 100),
  country_code char(2) not null default 'NG' check (country_code ~ '^[A-Z]{2}$'),
  pickup_at timestamptz,
  contents_description text not null check (length(btrim(contents_description)) between 3 and 1200),
  sender_note text check (sender_note is null or length(sender_note) <= 800),
  quote_amount_ngn_kobo bigint check (quote_amount_ngn_kobo > 0),
  quote_note text check (quote_note is null or length(quote_note) <= 600),
  status text not null default 'requested' check (status in ('requested','quoted','accepted','assigned','picked_up','in_transit','delivered','cancelled','issue')),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid','pending','paid')),
  driver_id uuid references public.profiles(id),
  vehicle_id uuid,
  delivery_proof text check (delivery_proof is null or length(delivery_proof) <= 500),
  issue_note text check (issue_note is null or length(issue_note) <= 800),
  quoted_at timestamptz,
  accepted_at timestamptz,
  assigned_at timestamptz,
  picked_up_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (vehicle_id, driver_id) references public.vehicles(id, driver_id),
  check ((vehicle_id is null) = (driver_id is null)),
  check ((status not in ('quoted','accepted','assigned','picked_up','in_transit','delivered') or quote_amount_ngn_kobo is not null)),
  check (status not in ('assigned','picked_up','in_transit','delivered') or driver_id is not null),
  check (status <> 'delivered' or (delivered_at is not null and delivery_proof is not null)),
  check (payment_status <> 'paid' or quote_amount_ngn_kobo is not null)
);

create index cargo_orders_sender_recent_idx on public.cargo_orders(sender_id, created_at desc);
create index cargo_orders_driver_active_idx on public.cargo_orders(driver_id, status, created_at desc);
create index cargo_orders_dispatch_idx on public.cargo_orders(status, created_at) where status in ('requested','accepted','issue');
create trigger cargo_orders_updated_at before update on public.cargo_orders
  for each row execute function private.set_updated_at();

create table public.cargo_order_events (
  id bigint generated always as identity primary key,
  cargo_order_id uuid not null references public.cargo_orders(id) on delete cascade,
  actor_id uuid references public.profiles(id),
  event_type text not null check (event_type in ('requested','quoted','quote_accepted','assigned','picked_up','in_transit','delivered','cancelled','issue','issue_resolved','payment_received')),
  note text check (note is null or length(note) <= 800),
  created_at timestamptz not null default now()
);
create index cargo_order_events_order_idx on public.cargo_order_events(cargo_order_id, created_at);

alter table public.vehicles drop constraint if exists vehicles_vehicle_type_check;
alter table public.vehicles add constraint vehicles_vehicle_type_check
  check (vehicle_type in ('car','keke','motorcycle','van','truck'));

alter table public.cargo_orders enable row level security;
alter table public.cargo_order_events enable row level security;
revoke all on public.cargo_orders, public.cargo_order_events from anon, authenticated;
grant select on public.cargo_orders, public.cargo_order_events to authenticated;
grant usage, select on sequence public.cargo_order_events_id_seq to movara_workflow_owner;
grant select, insert, update on public.cargo_orders, public.cargo_order_events to movara_workflow_owner;
create policy cargo_orders_read_parties on public.cargo_orders for select to authenticated
  using (sender_id = (select auth.uid()) or driver_id = (select auth.uid()) or (select private.has_role('administrator')));
create policy workflow_cargo_orders on public.cargo_orders for all to movara_workflow_owner using (true) with check (true);
create policy cargo_events_read_parties on public.cargo_order_events for select to authenticated
  using (exists(select 1 from public.cargo_orders c where c.id = cargo_order_id and
    (c.sender_id = (select auth.uid()) or c.driver_id = (select auth.uid()) or (select private.has_role('administrator')))));
create policy workflow_cargo_events on public.cargo_order_events for all to movara_workflow_owner using (true) with check (true);

alter table public.payments add column cargo_order_id uuid references public.cargo_orders(id) on delete restrict;
alter table public.payments add column authorization_url text;
alter table public.payments add column checkout_expires_at timestamptz;
alter table public.payments drop constraint if exists payments_payment_type_check;
alter table public.payments add constraint payments_payment_type_check
  check (payment_type in ('ride','cancellation_fee','wallet_topup','cargo'));
alter table public.payments add constraint payments_cargo_link_check
  check (payment_type <> 'cargo' or (cargo_order_id is not null and ride_id is null and landlord_fee_id is null));
create unique index payments_cargo_pending_or_paid_uq on public.payments(cargo_order_id)
  where cargo_order_id is not null and status in ('pending','succeeded');

grant movara_workflow_owner to postgres with set true, inherit false;
grant create on schema public to movara_workflow_owner;
grant usage on schema auth, public, private to movara_workflow_owner;
grant execute on function auth.uid() to movara_workflow_owner;
set role movara_workflow_owner;

create function public.cargo_create_request(
  p_recipient_name text, p_recipient_phone text, p_service_type text, p_package_size text,
  p_package_count integer, p_weight_kg numeric, p_declared_value_ngn_kobo bigint,
  p_fragile boolean, p_pickup_label text, p_pickup_city text, p_pickup_region text,
  p_destination_label text, p_destination_city text, p_destination_region text,
  p_pickup_at timestamptz, p_contents_description text, p_sender_note text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_order public.cargo_orders%rowtype;
begin
  if v_user is null or not private.has_role('customer') then raise exception 'A customer account is required.' using errcode='42501'; end if;
  if p_service_type not in ('documents','parcel','food','home_move','business_cargo')
    or p_package_size not in ('small','medium','large')
    or p_package_count not between 1 and 100 or p_weight_kg is null or p_weight_kg <= 0 or p_weight_kg > 10000
    or length(btrim(coalesce(p_recipient_name,''))) not between 2 and 120
    or length(regexp_replace(coalesce(p_recipient_phone,''),'[^0-9]','','g')) not between 7 and 15
    or length(btrim(coalesce(p_pickup_label,''))) not between 5 and 300
    or length(btrim(coalesce(p_destination_label,''))) not between 5 and 300
    or lower(btrim(p_pickup_label)) = lower(btrim(p_destination_label))
    or length(btrim(coalesce(p_pickup_city,''))) not between 2 and 100
    or length(btrim(coalesce(p_destination_city,''))) not between 2 and 100
    or length(btrim(coalesce(p_pickup_region,''))) not between 2 and 100
    or length(btrim(coalesce(p_destination_region,''))) not between 2 and 100
    or length(btrim(coalesce(p_contents_description,''))) not between 3 and 1200
    or length(coalesce(p_sender_note,'')) > 800
    or coalesce(p_declared_value_ngn_kobo,0) not between 0 and 10000000000 then
    raise exception 'Check the shipment details and try again.' using errcode='22023';
  end if;
  if p_pickup_at is not null and (p_pickup_at < now() + interval '30 minutes' or p_pickup_at > now() + interval '60 days') then
    raise exception 'Choose a pickup time at least 30 minutes from now and within 60 days.' using errcode='22023';
  end if;
  insert into public.cargo_orders(sender_id,recipient_name,recipient_phone,service_type,package_size,package_count,weight_kg,
    declared_value_ngn_kobo,fragile,pickup_label,pickup_city,pickup_region,destination_label,destination_city,destination_region,
    pickup_at,contents_description,sender_note)
  values(v_user,btrim(p_recipient_name),btrim(p_recipient_phone),p_service_type,p_package_size,p_package_count,p_weight_kg,
    coalesce(p_declared_value_ngn_kobo,0),coalesce(p_fragile,false),btrim(p_pickup_label),btrim(p_pickup_city),btrim(p_pickup_region),
    btrim(p_destination_label),btrim(p_destination_city),btrim(p_destination_region),p_pickup_at,btrim(p_contents_description),nullif(btrim(p_sender_note),''))
  returning * into v_order;
  insert into public.cargo_order_events(cargo_order_id,actor_id,event_type,note)
    values(v_order.id,v_user,'requested','Shipment request received. A MoVara operator will confirm the price and pickup window.');
  insert into public.notifications(user_id,kind,payload)
    select user_id,'cargo_request_received',jsonb_build_object('cargo_order_id',v_order.id,'tracking_code',v_order.tracking_code)
    from public.user_roles where role='administrator';
  perform private.write_audit(v_user,'cargo_request_created','cargo_order',v_order.id,
    jsonb_build_object('tracking_code',v_order.tracking_code,'service_type',v_order.service_type));
  return jsonb_build_object('id',v_order.id,'tracking_code',v_order.tracking_code,'status',v_order.status);
end;
$$;

create or replace function public.submit_driver_vehicle(
  p_vehicle_type text,p_make text,p_model text,p_registration_number text,p_capacity integer
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_driver uuid:=auth.uid(); v_vehicle uuid;
begin
  if v_driver is null or not exists(select 1 from public.user_roles where user_id=v_driver and role='driver')
    or not exists(select 1 from public.driver_verifications where driver_id=v_driver and status='approved') then
    raise exception 'Approved driver identity is required before adding a cargo vehicle.' using errcode='42501';
  end if;
  if p_vehicle_type not in ('car','keke','motorcycle','van','truck')
    or length(btrim(coalesce(p_make,''))) not between 1 and 80
    or length(btrim(coalesce(p_model,''))) not between 1 and 80
    or length(btrim(coalesce(p_registration_number,''))) not between 3 and 32
    or p_capacity not between 1 and 20 then raise exception 'Vehicle details are incomplete or invalid.' using errcode='22023'; end if;
  insert into public.vehicles(driver_id,vehicle_type,make,model,registration_number,capacity)
  values(v_driver,p_vehicle_type,btrim(p_make),btrim(p_model),upper(btrim(p_registration_number)),p_capacity)
  returning id into v_vehicle;
  perform private.write_audit(v_driver,'driver_vehicle_submitted','vehicle',v_vehicle,jsonb_build_object('vehicle_type',p_vehicle_type));
  return v_vehicle;
end;
$$;

create function public.admin_quote_cargo_order(p_order_id uuid,p_amount_ngn_kobo bigint,p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid();
begin
  if v_actor is null or not private.has_role('administrator') then raise exception 'Administrator access required.' using errcode='42501'; end if;
  if p_amount_ngn_kobo<=0 or p_amount_ngn_kobo>10000000000 or length(coalesce(p_note,''))>600 then raise exception 'Enter a valid cargo quote.' using errcode='22023'; end if;
  update public.cargo_orders set quote_amount_ngn_kobo=p_amount_ngn_kobo,quote_note=nullif(btrim(p_note),''),status='quoted',quoted_at=now()
    where id=p_order_id and status in ('requested','issue') and payment_status<>'paid';
  if not found then raise exception 'This request can no longer be quoted.' using errcode='22023'; end if;
  insert into public.cargo_order_events(cargo_order_id,actor_id,event_type,note) values(p_order_id,v_actor,'quoted',nullif(btrim(p_note),''));
  insert into public.notifications(user_id,kind,payload) select sender_id,'cargo_quote_ready',jsonb_build_object('cargo_order_id',id,'amount_ngn_kobo',p_amount_ngn_kobo) from public.cargo_orders where id=p_order_id;
  perform private.write_audit(v_actor,'cargo_quote_sent','cargo_order',p_order_id,jsonb_build_object('amount_ngn_kobo',p_amount_ngn_kobo));
  return p_order_id;
end;
$$;

create function public.customer_accept_cargo_quote(p_order_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid();
begin
  update public.cargo_orders set status='accepted',accepted_at=now()
    where id=p_order_id and sender_id=v_actor and status='quoted' and quote_amount_ngn_kobo is not null;
  if not found then raise exception 'This quote is no longer available.' using errcode='22023'; end if;
  insert into public.cargo_order_events(cargo_order_id,actor_id,event_type,note) values(p_order_id,v_actor,'quote_accepted','Sender accepted the delivery price. Payment is due before dispatch.');
  return p_order_id;
end;
$$;

create function public.customer_cancel_cargo_order(p_order_id uuid,p_reason text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid();
begin
  if length(coalesce(p_reason,''))>500 then raise exception 'Cancellation note is too long.' using errcode='22023'; end if;
  update public.cargo_orders set status='cancelled',cancelled_at=now(),issue_note=nullif(btrim(p_reason),'')
    where id=p_order_id and sender_id=v_actor and status in ('requested','quoted','accepted') and payment_status<>'paid';
  if not found then raise exception 'This shipment can no longer be cancelled here. Contact MoVara support.' using errcode='22023'; end if;
  insert into public.cargo_order_events(cargo_order_id,actor_id,event_type,note) values(p_order_id,v_actor,'cancelled',nullif(btrim(p_reason),''));
  return p_order_id;
end;
$$;

create function public.admin_assign_cargo_order(p_order_id uuid,p_driver_id uuid,p_vehicle_id uuid,p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid(); v_order public.cargo_orders%rowtype; v_type text;
begin
  if v_actor is null or not private.has_role('administrator') then raise exception 'Administrator access required.' using errcode='42501'; end if;
  select * into v_order from public.cargo_orders where id=p_order_id for update;
  if not found or v_order.status not in ('accepted','issue') or v_order.payment_status<>'paid' then raise exception 'The accepted quote must be paid before dispatch.' using errcode='22023'; end if;
  if not exists(select 1 from public.user_roles where user_id=p_driver_id and role='driver')
    or not exists(select 1 from public.driver_verifications where driver_id=p_driver_id and status='approved') then raise exception 'Choose an approved MoVara courier.' using errcode='22023'; end if;
  select vehicle_type into v_type from public.vehicles where id=p_vehicle_id and driver_id=p_driver_id and verification='approved';
  if v_type is null then raise exception 'Choose a vehicle approved for this courier.' using errcode='22023'; end if;
  if (v_order.package_size='large' and v_type not in ('van','truck'))
    or (v_order.package_size='medium' and v_type in ('motorcycle','keke'))
    or (v_order.weight_kg > case v_type when 'motorcycle' then 25 when 'keke' then 200 when 'car' then 500 when 'van' then 2000 else 10000 end) then
    raise exception 'That vehicle is too small for this shipment.' using errcode='22023';
  end if;
  update public.cargo_orders set driver_id=p_driver_id,vehicle_id=p_vehicle_id,status='assigned',assigned_at=now(),issue_note=null
    where id=p_order_id;
  insert into public.cargo_order_events(cargo_order_id,actor_id,event_type,note)
    values(p_order_id,v_actor,case when v_order.status='issue' then 'issue_resolved' else 'assigned' end,nullif(btrim(p_note),''));
  insert into public.notifications(user_id,kind,payload) values(p_driver_id,'cargo_delivery_assigned',jsonb_build_object('cargo_order_id',p_order_id,'tracking_code',v_order.tracking_code));
  insert into public.notifications(user_id,kind,payload) values(v_order.sender_id,'cargo_delivery_assigned',jsonb_build_object('cargo_order_id',p_order_id,'tracking_code',v_order.tracking_code));
  perform private.write_audit(v_actor,'cargo_delivery_assigned','cargo_order',p_order_id,jsonb_build_object('driver_id',p_driver_id,'vehicle_id',p_vehicle_id));
  return p_order_id;
end;
$$;

create function public.driver_update_cargo_status(p_order_id uuid,p_new_status text,p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid(); v_order public.cargo_orders%rowtype; v_event text;
begin
  if v_actor is null or not private.has_role('driver') then raise exception 'Courier access required.' using errcode='42501'; end if;
  select * into v_order from public.cargo_orders where id=p_order_id and driver_id=v_actor for update;
  if not found then raise exception 'This shipment is not assigned to you.' using errcode='42501'; end if;
  if length(coalesce(p_note,''))>500 or (p_new_status='delivered' and length(btrim(coalesce(p_note,'')))<3)
    or p_new_status not in ('picked_up','in_transit','delivered','issue') then raise exception 'Add the required delivery update.' using errcode='22023'; end if;
  if not ((v_order.status='assigned' and p_new_status in ('picked_up','issue'))
    or (v_order.status='picked_up' and p_new_status in ('in_transit','issue'))
    or (v_order.status='in_transit' and p_new_status in ('delivered','issue'))
    or (v_order.status='issue' and p_new_status in ('picked_up','in_transit','delivered'))) then raise exception 'This delivery update is out of sequence.' using errcode='22023'; end if;
  update public.cargo_orders set status=p_new_status,
    picked_up_at=case when p_new_status='picked_up' then coalesce(picked_up_at,now()) else picked_up_at end,
    delivered_at=case when p_new_status='delivered' then now() else delivered_at end,
    delivery_proof=case when p_new_status='delivered' then btrim(p_note) else delivery_proof end,
    issue_note=case when p_new_status='issue' then btrim(p_note) else null end
    where id=p_order_id;
  v_event:=case when p_new_status='issue' then 'issue' else p_new_status end;
  insert into public.cargo_order_events(cargo_order_id,actor_id,event_type,note) values(p_order_id,v_actor,v_event,btrim(p_note));
  insert into public.notifications(user_id,kind,payload) values(v_order.sender_id,'cargo_status_update',jsonb_build_object('cargo_order_id',p_order_id,'status',p_new_status,'note',btrim(p_note)));
  return p_order_id;
end;
$$;

create function public.admin_cancel_cargo_order(p_order_id uuid,p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid(); v_order public.cargo_orders%rowtype;
begin
  if v_actor is null or not private.has_role('administrator') then raise exception 'Administrator access required.' using errcode='42501'; end if;
  if length(btrim(coalesce(p_reason,''))) not between 3 and 500 then raise exception 'Give a clear cancellation reason.' using errcode='22023'; end if;
  select * into v_order from public.cargo_orders where id=p_order_id for update;
  if not found or v_order.status in ('delivered','cancelled') then raise exception 'This shipment can no longer be cancelled.' using errcode='22023'; end if;
  if v_order.payment_status='paid' then raise exception 'Request a refund before cancelling a paid cargo order.' using errcode='22023'; end if;
  update public.cargo_orders set status='cancelled',cancelled_at=now(),issue_note=btrim(p_reason) where id=p_order_id;
  insert into public.cargo_order_events(cargo_order_id,actor_id,event_type,note) values(p_order_id,v_actor,'cancelled',btrim(p_reason));
  insert into public.notifications(user_id,kind,payload) values(v_order.sender_id,'cargo_status_update',jsonb_build_object('cargo_order_id',p_order_id,'status','cancelled','note',btrim(p_reason)));
  return p_order_id;
end;
$$;

reset role;
revoke create on schema public from movara_workflow_owner;
revoke movara_workflow_owner from postgres;
alter function public.cargo_create_request(text,text,text,text,integer,numeric,bigint,boolean,text,text,text,text,text,text,timestamptz,text,text) owner to movara_workflow_owner;
alter function public.submit_driver_vehicle(text,text,text,text,integer) owner to movara_workflow_owner;
alter function public.admin_quote_cargo_order(uuid,bigint,text) owner to movara_workflow_owner;
alter function public.customer_accept_cargo_quote(uuid) owner to movara_workflow_owner;
alter function public.customer_cancel_cargo_order(uuid,text) owner to movara_workflow_owner;
alter function public.admin_assign_cargo_order(uuid,uuid,uuid,text) owner to movara_workflow_owner;
alter function public.driver_update_cargo_status(uuid,text,text) owner to movara_workflow_owner;
alter function public.admin_cancel_cargo_order(uuid,text) owner to movara_workflow_owner;
revoke all on function public.cargo_create_request(text,text,text,text,integer,numeric,bigint,boolean,text,text,text,text,text,text,timestamptz,text,text) from public,anon;
revoke all on function public.submit_driver_vehicle(text,text,text,text,integer) from public,anon;
revoke all on function public.admin_quote_cargo_order(uuid,bigint,text) from public,anon;
revoke all on function public.customer_accept_cargo_quote(uuid) from public,anon;
revoke all on function public.customer_cancel_cargo_order(uuid,text) from public,anon;
revoke all on function public.admin_assign_cargo_order(uuid,uuid,uuid,text) from public,anon;
revoke all on function public.driver_update_cargo_status(uuid,text,text) from public,anon;
revoke all on function public.admin_cancel_cargo_order(uuid,text) from public,anon;
grant execute on function public.cargo_create_request(text,text,text,text,integer,numeric,bigint,boolean,text,text,text,text,text,text,timestamptz,text,text) to authenticated;
grant execute on function public.submit_driver_vehicle(text,text,text,text,integer) to authenticated;
grant execute on function public.admin_quote_cargo_order(uuid,bigint,text) to authenticated;
grant execute on function public.customer_accept_cargo_quote(uuid) to authenticated;
grant execute on function public.customer_cancel_cargo_order(uuid,text) to authenticated;
grant execute on function public.admin_assign_cargo_order(uuid,uuid,uuid,text) to authenticated;
grant execute on function public.driver_update_cargo_status(uuid,text,text) to authenticated;
grant execute on function public.admin_cancel_cargo_order(uuid,text) to authenticated;

create function private.cargo_payment_status_update()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_state text;
begin
  if new.payment_type <> 'cargo' or new.cargo_order_id is null
    or (TG_OP = 'UPDATE' and new.status is not distinct from old.status) then return new; end if;
  v_state := case when new.status='succeeded' then 'paid' when new.status='pending' then 'pending' else 'unpaid' end;
  update public.cargo_orders set payment_status=v_state where id=new.cargo_order_id;
  if v_state='paid' then
    insert into public.cargo_order_events(cargo_order_id,actor_id,event_type,note) values(new.cargo_order_id,new.payer_id,'payment_received','Paystack confirmed the delivery payment.');
    insert into public.notifications(user_id,kind,payload) values(new.payer_id,'cargo_payment_received',jsonb_build_object('cargo_order_id',new.cargo_order_id,'amount_ngn_kobo',new.amount_kobo));
  end if;
  return new;
end;
$$;
create trigger cargo_payment_status_update after insert or update of status on public.payments
  for each row execute function private.cargo_payment_status_update();

do $$ begin
  if exists(select 1 from pg_catalog.pg_publication where pubname='supabase_realtime')
    and not exists(select 1 from pg_catalog.pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='cargo_orders') then
    alter publication supabase_realtime add table public.cargo_orders;
  end if;
end $$;
