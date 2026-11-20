-- Notification preferences, delivery history, device registrations, and events.
alter table public.notifications add column if not exists event_key text;
create unique index if not exists notifications_user_event_key_idx
  on public.notifications(user_id,event_key) where event_key is not null;

create table public.notification_preferences (
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  channel text not null check(channel in ('in_app','email','sms','push')),
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key(user_id,kind,channel)
);
alter table public.notification_preferences enable row level security;
create policy notification_preferences_read_own on public.notification_preferences
  for select to authenticated using(user_id=(select auth.uid()));
grant select on public.notification_preferences to authenticated;

create table public.notification_delivery_logs (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  channel text not null check(channel in ('email','sms','push')),
  provider text not null check(length(provider) between 1 and 40),
  destination_hash text not null check(length(destination_hash) between 16 and 128),
  status text not null check(status in ('queued','sent','failed','skipped')),
  provider_message_id text,
  error_code text,
  created_at timestamptz not null default now(),
  unique(notification_id,channel,provider,destination_hash)
);
create index notification_delivery_user_recent_idx
  on public.notification_delivery_logs(user_id,created_at desc);
alter table public.notification_delivery_logs enable row level security;
create policy notification_delivery_logs_read_own on public.notification_delivery_logs
  for select to authenticated using(user_id=(select auth.uid()));
grant select on public.notification_delivery_logs to authenticated;

create table public.push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null check(provider in ('expo','fcm')),
  platform text not null check(platform in ('ios','android','web')),
  token text not null check(length(token) between 20 and 4096),
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  unique(provider,token)
);
alter table public.push_devices enable row level security;
create policy push_devices_read_own on public.push_devices
  for select to authenticated using(user_id=(select auth.uid()));
grant select on public.push_devices to authenticated;

grant usage on schema private to movara_workflow_owner;
grant execute on function private.has_role(public.app_role) to movara_workflow_owner;
grant select on public.profiles,public.user_roles,public.notification_preferences,
  public.rides,public.property_viewings,public.driver_verifications,
  public.landlord_verifications,public.support_tickets,public.ride_safety_events
  to movara_workflow_owner;
grant insert on public.notifications to movara_workflow_owner;
grant update(read_at) on public.notifications to movara_workflow_owner;
grant insert,update on public.notification_preferences to movara_workflow_owner;
grant insert,select,update on public.push_devices to movara_workflow_owner;
grant insert,update on public.notifications to movara_workflow_owner;

grant movara_workflow_owner to postgres with set true, inherit false;
grant create on schema public to movara_workflow_owner;
set role movara_workflow_owner;

create function public.notification_set_preference(p_kind text,p_channel text,p_enabled boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid:=auth.uid();
begin
  if v_user is null or p_channel not in ('in_app','email','sms','push') or
    p_kind not in ('all','ride_accepted','driver_arrived','ride_started','ride_completed',
      'ride_cancelled','property_enquiry','viewing_scheduled','viewing_approved',
      'viewing_cancelled','support_updated','sos_raised','driver_approved',
      'driver_rejected','landlord_approved','landlord_rejected','wallet_transaction',
      'refund_approved','corporate_approval','service_announcement','maintenance_notice',
      'safety_notice') then
    raise exception 'Notification preference is invalid' using errcode='22023';
  end if;
  insert into public.notification_preferences(user_id,kind,channel,enabled,updated_at)
    values(v_user,p_kind,p_channel,p_enabled,pg_catalog.now())
    on conflict(user_id,kind,channel) do update
      set enabled=excluded.enabled,updated_at=excluded.updated_at;
end;
$$;

create function public.notification_register_device(p_provider text,p_platform text,p_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid:=auth.uid(); v_id uuid;
begin
  if v_user is null or p_provider not in ('expo','fcm') or
    p_platform not in ('ios','android','web') or length(coalesce(p_token,'')) not between 20 and 4096 then
    raise exception 'Push device details are invalid' using errcode='22023';
  end if;
  insert into public.push_devices(user_id,provider,platform,token,enabled,updated_at)
    values(v_user,p_provider,p_platform,p_token,true,pg_catalog.now())
    on conflict(provider,token) do update set user_id=excluded.user_id,
      platform=excluded.platform,enabled=true,updated_at=excluded.updated_at
    returning id into v_id;
  return v_id;
end;
$$;

create function public.notification_remove_device(p_device_id uuid)
returns void language sql security definer set search_path = '' as $$
  update public.push_devices set enabled=false,updated_at=pg_catalog.now()
  where id=p_device_id and user_id=auth.uid();
$$;

create function public.notification_mark_all_read()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_user uuid:=auth.uid(); v_count integer;
begin
  if v_user is null then raise exception 'Sign in required' using errcode='42501'; end if;
  update public.notifications set read_at=pg_catalog.now() where user_id=v_user and read_at is null;
  get diagnostics v_count=row_count; return v_count;
end;
$$;

create function public.admin_notification_broadcast(p_kind text,p_title text,p_body text,p_role public.app_role default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid(); v_broadcast uuid:=gen_random_uuid(); v_count integer;
begin
  if v_actor is null or not private.has_role('administrator') or
    p_kind not in ('service_announcement','maintenance_notice','safety_notice') or
    length(pg_catalog.btrim(coalesce(p_title,''))) not between 1 and 120 or
    length(pg_catalog.btrim(coalesce(p_body,''))) not between 1 and 1000 then
    raise exception 'Notification broadcast is not permitted or invalid' using errcode='42501';
  end if;
  insert into public.notifications(user_id,kind,payload,event_key)
  select p.id,p_kind,pg_catalog.jsonb_build_object('title',pg_catalog.btrim(p_title),
    'body',pg_catalog.btrim(p_body),'broadcast_id',v_broadcast),
    'broadcast:'||v_broadcast::text||':'||p.id::text
  from public.profiles p where p_role is null or exists(
    select 1 from public.user_roles r where r.user_id=p.id and r.role=p_role);
  get diagnostics v_count=row_count;
  perform private.write_audit(v_actor,'notification_broadcast_created','notification_broadcast',
    v_broadcast,pg_catalog.jsonb_build_object('kind',p_kind,'recipient_count',v_count));
  return v_count;
end;
$$;

create function private.notify_ride_status_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_kind text; v_payload jsonb; v_key text;
begin
  if new.status is not distinct from old.status then return new; end if;
  v_kind:=case new.status::text when 'accepted' then 'ride_accepted'
    when 'in_progress' then 'ride_started' when 'completed' then 'ride_completed'
    when 'cancelled' then 'ride_cancelled' else null end;
  if v_kind is null then return new; end if;
  if exists(select 1 from public.notification_preferences n where n.user_id=new.customer_id
      and n.kind in ('all',v_kind) and n.channel='in_app' and not n.enabled) then return new; end if;
  v_payload:=pg_catalog.jsonb_build_object('ride_id',new.id,'pickup',new.pickup_label,
    'destination',new.destination_label,'status',new.status::text);
  v_key:='ride:'||new.id::text||':'||new.status::text;
  insert into public.notifications(user_id,kind,payload,event_key)
    values(new.customer_id,v_kind,v_payload,v_key||':customer') on conflict do nothing;
  if new.status in ('completed','cancelled') and new.driver_id is not null then
    if not exists(select 1 from public.notification_preferences n where n.user_id=new.driver_id
      and n.kind in ('all',v_kind) and n.channel='in_app' and not n.enabled) then
      insert into public.notifications(user_id,kind,payload,event_key)
        values(new.driver_id,v_kind,v_payload,v_key||':driver') on conflict do nothing;
    end if;
  end if;
  return new;
end;
$$;

create function private.notification_assign_event_key()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.event_key is null and new.kind='enquiry_received'
    and new.payload->>'enquiry_id' is not null then
    new.event_key:='enquiry:'||(new.payload->>'enquiry_id')||':received';
  elsif new.event_key is null and new.kind in ('enquiry_message','enquiry_reply')
    and new.payload->>'message_id' is not null then
    new.event_key:='enquiry-message:'||(new.payload->>'message_id')||':'||new.user_id::text;
  end if;
  return new;
end;
$$;

create function private.notify_viewing_status_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_kind text;
begin
  if new.status is not distinct from old.status then return new; end if;
  v_kind:=case new.status::text when 'arranged' then 'viewing_scheduled'
    when 'cancelled' then 'viewing_cancelled' else null end;
  if v_kind is null then return new; end if;
  insert into public.notifications(user_id,kind,payload,event_key)
    values(new.tenant_id,v_kind,pg_catalog.jsonb_build_object('viewing_id',new.id,
      'property_id',new.property_id,'proposed_at',new.proposed_at),
      'viewing:'||new.id::text||':'||new.status::text||':tenant') on conflict do nothing;
  insert into public.notifications(user_id,kind,payload,event_key)
    values(new.landlord_id,v_kind,pg_catalog.jsonb_build_object('viewing_id',new.id,
      'property_id',new.property_id,'proposed_at',new.proposed_at),
      'viewing:'||new.id::text||':'||new.status::text||':landlord') on conflict do nothing;
  return new;
end;
$$;

create function private.notify_marketplace_verification()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_role text:=tg_argv[0]; v_user uuid; v_kind text;
begin
  if new.status is not distinct from old.status then return new; end if;
  v_user:=(pg_catalog.to_jsonb(new)->>case when v_role='driver' then 'driver_id' else 'landlord_id' end)::uuid;
  v_kind:=case new.status::text when 'approved' then v_role||'_approved'
    when 'rejected' then v_role||'_rejected' else null end;
  if v_kind is null then return new; end if;
  insert into public.notifications(user_id,kind,payload,event_key)
    values(v_user,v_kind,pg_catalog.jsonb_build_object('status',new.status::text),
      v_role||':'||v_user::text||':'||new.status::text||':'||new.updated_at::text)
    on conflict do nothing;
  return new;
end;
$$;

create function private.notify_support_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_user uuid; v_kind text; v_key text; v_row jsonb:=pg_catalog.to_jsonb(new);
begin
  if tg_table_name='support_tickets' then
    if tg_op='INSERT' then v_user:=(v_row->>'reporter_id')::uuid; v_kind:='support_updated';
      v_key:='support:new:'||(v_row->>'id');
    elsif v_row->>'status' is distinct from pg_catalog.to_jsonb(old)->>'status'
      or v_row->>'resolution' is distinct from pg_catalog.to_jsonb(old)->>'resolution' then
      v_user:=(v_row->>'reporter_id')::uuid; v_kind:='support_updated';
      v_key:='support:'||(v_row->>'id')||':'||(v_row->>'updated_at');
    else return new; end if;
  else
    if tg_op='INSERT' and v_row->>'event_type'='sos' then
      v_user:=(v_row->>'reporter_id')::uuid; v_kind:='sos_raised'; v_key:='sos:'||(v_row->>'id');
    else return new; end if;
  end if;
  insert into public.notifications(user_id,kind,payload,event_key)
    values(v_user,v_kind,pg_catalog.jsonb_build_object('record_id',v_row->>'id',
      'status',case when tg_table_name='support_tickets' then v_row->>'status' else null end),v_key)
    on conflict do nothing;
  return new;
end;
$$;

reset role;
revoke movara_workflow_owner from postgres;
revoke create on schema public from movara_workflow_owner;

alter function public.notification_set_preference(text,text,boolean) owner to movara_workflow_owner;
alter function public.notification_register_device(text,text,text) owner to movara_workflow_owner;
alter function public.notification_remove_device(uuid) owner to movara_workflow_owner;
alter function public.notification_mark_all_read() owner to movara_workflow_owner;
alter function public.admin_notification_broadcast(text,text,text,public.app_role) owner to movara_workflow_owner;
alter function private.notify_ride_status_change() owner to movara_workflow_owner;
alter function private.notification_assign_event_key() owner to movara_workflow_owner;
alter function private.notify_viewing_status_change() owner to movara_workflow_owner;
alter function private.notify_marketplace_verification() owner to movara_workflow_owner;
alter function private.notify_support_event() owner to movara_workflow_owner;
create trigger notification_ride_status_change after update of status on public.rides
  for each row execute function private.notify_ride_status_change();
create trigger notification_viewing_status_change after update of status on public.property_viewings
  for each row execute function private.notify_viewing_status_change();
create trigger notification_driver_verification after update of status on public.driver_verifications
  for each row execute function private.notify_marketplace_verification('driver');
create trigger notification_landlord_verification after update of status on public.landlord_verifications
  for each row execute function private.notify_marketplace_verification('landlord');
create trigger notification_support_ticket_insert after insert on public.support_tickets
  for each row execute function private.notify_support_event();
create trigger notification_support_ticket_update after update on public.support_tickets
  for each row execute function private.notify_support_event();
create trigger notification_sos_insert after insert on public.ride_safety_events
  for each row execute function private.notify_support_event();
create trigger notification_assign_event_key before insert on public.notifications
  for each row execute function private.notification_assign_event_key();
revoke all on function public.notification_set_preference(text,text,boolean),
  public.notification_register_device(text,text,text),public.notification_remove_device(uuid),
  public.notification_mark_all_read(),public.admin_notification_broadcast(text,text,text,public.app_role)
  from public,anon;
grant execute on function public.notification_set_preference(text,text,boolean),
  public.notification_register_device(text,text,text),public.notification_remove_device(uuid),
  public.notification_mark_all_read(),public.admin_notification_broadcast(text,text,text,public.app_role)
  to authenticated;
revoke all on function private.notify_ride_status_change(),private.notify_viewing_status_change(),
  private.notify_marketplace_verification(),private.notify_support_event(),
  private.notification_assign_event_key() from public,anon,authenticated;
grant execute on function private.notify_ride_status_change(),private.notify_viewing_status_change(),
  private.notify_marketplace_verification(),private.notify_support_event(),
  private.notification_assign_event_key() to movara_workflow_owner;
create policy workflow_notification_preferences on public.notification_preferences
  for all to movara_workflow_owner using(true) with check(true);
create policy workflow_profiles_read on public.profiles
  for select to movara_workflow_owner using(true);
create policy workflow_notification_logs on public.notification_delivery_logs
  for all to service_role using(true) with check(true);
create policy workflow_push_devices on public.push_devices
  for all to service_role using(true) with check(true);
create policy workflow_push_devices_owner on public.push_devices
  for all to movara_workflow_owner using(true) with check(true);
create policy workflow_notifications_update on public.notifications
  for update to movara_workflow_owner using(true) with check(true);
create policy workflow_notifications_read on public.notifications
  for select to movara_workflow_owner using(true);
grant select,insert,update on public.notifications to movara_workflow_owner;
grant select on public.notification_preferences,public.rides to movara_workflow_owner;
grant select on public.profiles,public.user_roles,public.property_viewings,
  public.driver_verifications,public.landlord_verifications,
  public.support_tickets,public.ride_safety_events to movara_workflow_owner;
grant insert,update on public.notification_preferences,public.push_devices to movara_workflow_owner;
grant select,insert,update on public.notification_delivery_logs,public.push_devices to service_role;
