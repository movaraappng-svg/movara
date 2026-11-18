-- Trusted workflows and API/storage permissions.
-- All RPCs are transaction-scoped PostgreSQL functions. Do not execute this
-- migration against a hosted project before review and explicit approval.

do $$
begin
  create role movara_workflow_owner nologin noinherit nobypassrls;
exception when duplicate_object then
  null;
end;
$$;
alter role movara_workflow_owner nologin noinherit nobypassrls;
grant movara_workflow_owner to postgres with set true, inherit false;
grant create on schema public, private to movara_workflow_owner;
grant usage on schema public, private, auth to movara_workflow_owner;
grant execute on function auth.uid() to movara_workflow_owner;
grant execute on function private.has_role(public.app_role)
  to movara_workflow_owner;

-- This non-login function owner has only the row-level access required by
-- trusted RPCs. It is not a table owner, superuser, BYPASSRLS role, or client role.
grant select on public.profiles, public.user_roles, public.role_requests,
  public.properties, public.enquiries, public.enquiry_messages,
  public.tenancy_search_cycles, public.property_viewings,
  public.property_viewing_reschedules, public.property_viewing_events,
  public.landlord_connection_fee_settings, public.connection_outcomes,
  public.landlord_connection_fees, public.disputes, public.payments,
  public.vehicles,
  public.driver_documents, public.landlord_documents, public.driver_verifications,
  public.landlord_verifications, public.property_verifications,
  public.property_images to movara_workflow_owner;
grant insert, update on public.enquiries, public.tenancy_search_cycles,
  public.property_viewings, public.property_viewing_reschedules,
  public.property_viewing_events, public.connection_outcomes,
  public.landlord_connection_fees, public.landlord_connection_fee_settings,
  public.disputes, public.payments,
  public.enquiry_messages, public.notifications,
  public.audit_logs, public.role_requests, public.user_roles,
  public.driver_documents, public.landlord_documents, public.property_images,
  public.vehicles,
  public.driver_verifications, public.landlord_verifications,
  public.property_verifications, public.verification_audit_logs,
  public.properties to movara_workflow_owner;
grant delete on public.user_roles to movara_workflow_owner;
grant usage, select on sequence public.audit_logs_id_seq
  to movara_workflow_owner;

create policy workflow_read_properties on public.properties
  for select to movara_workflow_owner using (true);
create policy workflow_read_enquiries on public.enquiries
  for select to movara_workflow_owner using (true);
create policy workflow_write_enquiries on public.enquiries
  for all to movara_workflow_owner using (true) with check (true);
create policy workflow_enquiry_messages on public.enquiry_messages
  for all to movara_workflow_owner using (true) with check (true);
create policy workflow_notifications on public.notifications
  for insert to movara_workflow_owner with check (true);
create policy workflow_cycles on public.tenancy_search_cycles
  for all to movara_workflow_owner using (true) with check (true);
create policy workflow_viewings on public.property_viewings
  for all to movara_workflow_owner using (true) with check (true);
create policy workflow_reschedules on public.property_viewing_reschedules
  for all to movara_workflow_owner using (true) with check (true);
create policy workflow_viewing_events on public.property_viewing_events
  for all to movara_workflow_owner using (true) with check (true);
create policy workflow_fee_settings on public.landlord_connection_fee_settings
  for all to movara_workflow_owner using (true) with check (true);
create policy workflow_outcomes on public.connection_outcomes
  for all to movara_workflow_owner using (true) with check (true);
create policy workflow_fees on public.landlord_connection_fees
  for all to movara_workflow_owner using (true) with check (true);
create policy workflow_disputes on public.disputes
  for all to movara_workflow_owner using (true) with check (true);
create policy workflow_payments on public.payments
  for all to movara_workflow_owner using (true) with check (true);
create policy workflow_audit_logs on public.audit_logs
  for insert to movara_workflow_owner with check (true);
create policy workflow_role_requests on public.role_requests
  for all to movara_workflow_owner using (true) with check (true);
create policy workflow_user_roles on public.user_roles
  for all to movara_workflow_owner using (true) with check (true);
create policy workflow_driver_verifications on public.driver_verifications
  for all to movara_workflow_owner using (true) with check (true);
create policy workflow_landlord_verifications on public.landlord_verifications
  for all to movara_workflow_owner using (true) with check (true);
create policy workflow_property_verifications on public.property_verifications
  for all to movara_workflow_owner using (true) with check (true);
create policy workflow_verification_audit_logs on public.verification_audit_logs
  for insert to movara_workflow_owner with check (true);
create policy workflow_update_properties on public.properties
  for update to movara_workflow_owner using (true) with check (true);
create policy workflow_driver_documents on public.driver_documents
  for all to movara_workflow_owner using (true) with check (true);
create policy workflow_vehicles on public.vehicles
  for all to movara_workflow_owner using (true) with check (true);
create policy workflow_landlord_documents on public.landlord_documents
  for all to movara_workflow_owner using (true) with check (true);
create policy workflow_property_images on public.property_images
  for all to movara_workflow_owner using (true) with check (true);

create function private.lock_key(p_key text)
returns void language sql volatile security definer
set search_path = ''
as $$
  select pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_key, 0)
  );
$$;
alter function private.lock_key(text) owner to movara_workflow_owner;

create function private.write_audit(
  p_actor uuid, p_action text, p_entity_type text,
  p_entity_id uuid, p_details jsonb default '{}'::jsonb
)
returns void language sql volatile security definer
set search_path = ''
as $$
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, details)
  values (p_actor, p_action, p_entity_type, p_entity_id,
          coalesce(p_details, '{}'::jsonb));
$$;
alter function private.write_audit(uuid, text, text, uuid, jsonb)
  owner to movara_workflow_owner;

create function public.request_marketplace_role(p_role public.app_role)
returns uuid language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_request uuid;
begin
  if v_user is null or p_role not in ('driver', 'landlord') then
    raise exception 'Role request not permitted' using errcode = '42501';
  end if;
  insert into public.role_requests(user_id, requested_role)
  values (v_user, p_role)
  on conflict (user_id, requested_role) do update
    set updated_at = pg_catalog.now()
  returning id into v_request;
  if p_role = 'driver' then
    insert into public.driver_verifications(driver_id)
    values (v_user) on conflict (driver_id) do nothing;
  else
    insert into public.landlord_verifications(landlord_id)
    values (v_user) on conflict (landlord_id) do nothing;
  end if;
  perform private.write_audit(v_user, 'role_requested', 'role_request',
    v_request, pg_catalog.jsonb_build_object('role', p_role::text));
  return v_request;
end;
$$;
alter function public.request_marketplace_role(public.app_role)
  owner to movara_workflow_owner;

create function public.create_enquiry(
  p_property_id uuid, p_message text, p_idempotency_key uuid
)
returns uuid language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_landlord uuid;
  v_enquiry uuid;
  v_cycle uuid;
  v_message uuid;
  v_created boolean := false;
begin
  if v_user is null or p_idempotency_key is null
    or length(pg_catalog.btrim(coalesce(p_message, ''))) not between 1 and 5000 then
    raise exception 'Invalid enquiry request' using errcode = '22023';
  end if;
  select p.landlord_id into v_landlord
  from public.properties p
  where p.id = p_property_id and p.status = 'published';
  if v_landlord is null or v_landlord = v_user then
    raise exception 'Property is unavailable for enquiry' using errcode = '22023';
  end if;

  perform private.lock_key('cycle-pair:' || p_property_id::text || ':' ||
    v_landlord::text || ':' || v_user::text);
  insert into public.enquiries
    (property_id, landlord_id, customer_id, idempotency_key)
  values (p_property_id, v_landlord, v_user, p_idempotency_key)
  on conflict (customer_id, idempotency_key) where idempotency_key is not null
    do nothing
  returning id into v_enquiry;
  v_created := v_enquiry is not null;
  if v_enquiry is null then
    select e.id into v_enquiry from public.enquiries e
    where e.customer_id = v_user and e.idempotency_key = p_idempotency_key;
    if not exists (
      select 1 from public.enquiries e where e.id = v_enquiry
        and e.property_id = p_property_id and e.landlord_id = v_landlord
    ) then
      raise exception 'Idempotency key already used for a different request'
        using errcode = '22023';
    end if;
  end if;

  if v_created then
    insert into public.enquiry_messages(
      enquiry_id, sender_id, body, idempotency_key
    ) values (v_enquiry, v_user, p_message, p_idempotency_key)
    returning id into v_message;
    update public.enquiries set last_message_at = pg_catalog.now()
      where id = v_enquiry;
    insert into public.notifications(user_id, kind, payload)
      values (v_landlord, 'enquiry_received',
        pg_catalog.jsonb_build_object('enquiry_id', v_enquiry,
          'message_id', v_message));
  end if;

  select c.id into v_cycle from public.tenancy_search_cycles c
  where c.property_id = p_property_id and c.landlord_id = v_landlord
    and c.tenant_id = v_user and c.status = 'open';
  if v_cycle is null then
    if exists (
      select 1 from public.tenancy_search_cycles c
      where c.property_id = p_property_id and c.landlord_id = v_landlord
        and c.tenant_id = v_user
    ) then
      raise exception 'A new tenancy cycle requires administrator authorization'
        using errcode = '42501';
    end if;
    insert into public.tenancy_search_cycles
      (property_id, landlord_id, tenant_id, cycle_number, created_by)
    values (p_property_id, v_landlord, v_user, 1, v_user)
    returning id into v_cycle;
  end if;
  perform private.write_audit(v_user, 'enquiry_created', 'enquiry',
    v_enquiry, pg_catalog.jsonb_build_object('cycle_id', v_cycle));
  return v_enquiry;
end;
$$;
alter function public.create_enquiry(uuid, text, uuid)
  owner to movara_workflow_owner;

create function public.send_enquiry_message(
  p_enquiry_id uuid, p_body text, p_idempotency_key uuid
)
returns uuid language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_enquiry public.enquiries%rowtype;
  v_message uuid;
  v_existing public.enquiry_messages%rowtype;
  v_recipient uuid;
begin
  if v_user is null or p_idempotency_key is null
    or length(pg_catalog.btrim(coalesce(p_body, ''))) not between 1 and 5000 then
    raise exception 'Invalid enquiry message' using errcode = '22023';
  end if;
  select * into v_enquiry from public.enquiries
    where id = p_enquiry_id;
  if not found or v_user not in (v_enquiry.customer_id, v_enquiry.landlord_id) then
    raise exception 'Enquiry access denied' using errcode = '42501';
  end if;
  perform private.lock_key('enquiry:' || p_enquiry_id::text);
  select * into v_enquiry from public.enquiries
    where id = p_enquiry_id for update;
  select * into v_existing from public.enquiry_messages
    where enquiry_id = p_enquiry_id and sender_id = v_user
      and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.body <> p_body then
      raise exception 'Idempotency key already used for a different message'
        using errcode = '22023';
    end if;
    return v_existing.id;
  end if;
  insert into public.enquiry_messages(
    enquiry_id, sender_id, body, idempotency_key
  ) values (p_enquiry_id, v_user, p_body, p_idempotency_key)
  returning id into v_message;
  update public.enquiries set last_message_at = pg_catalog.now()
    where id = p_enquiry_id;
  v_recipient := case when v_user = v_enquiry.customer_id
    then v_enquiry.landlord_id else v_enquiry.customer_id end;
  insert into public.notifications(user_id, kind, payload)
    values (v_recipient, 'enquiry_message',
      pg_catalog.jsonb_build_object('enquiry_id', p_enquiry_id,
        'message_id', v_message));
  perform private.write_audit(v_user, 'enquiry_message_sent',
    'enquiry_message', v_message,
    pg_catalog.jsonb_build_object('enquiry_id', p_enquiry_id));
  return v_message;
end;
$$;
alter function public.send_enquiry_message(uuid, text, uuid)
  owner to movara_workflow_owner;

create function public.create_property_viewing(
  p_enquiry_id uuid, p_cycle_id uuid, p_proposed_at timestamptz,
  p_idempotency_key uuid
)
returns uuid language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_enquiry public.enquiries%rowtype;
  v_cycle public.tenancy_search_cycles%rowtype;
  v_viewing uuid;
  v_existing uuid;
  v_closed_viewing uuid;
begin
  if v_user is null or p_idempotency_key is null
    or p_proposed_at <= pg_catalog.now() then
    raise exception 'Invalid viewing request' using errcode = '22023';
  end if;
  select * into v_enquiry from public.enquiries e where e.id = p_enquiry_id;
  if not found or v_user not in (v_enquiry.customer_id, v_enquiry.landlord_id) then
    raise exception 'Viewing request not permitted' using errcode = '42501';
  end if;

  perform private.lock_key('cycle:' || p_cycle_id::text);
  perform private.lock_key('enquiry:' || p_enquiry_id::text);
  select * into v_cycle from public.tenancy_search_cycles c
  where c.id = p_cycle_id for update;
  if not found or v_cycle.status <> 'open'
    or v_cycle.property_id <> v_enquiry.property_id
    or v_cycle.landlord_id <> v_enquiry.landlord_id
    or v_cycle.tenant_id <> v_enquiry.customer_id then
    raise exception 'Cycle does not match the enquiry' using errcode = '22023';
  end if;
  if not exists (select 1 from public.properties p
    where p.id = v_enquiry.property_id and p.landlord_id = v_enquiry.landlord_id
      and p.status = 'published') then
    raise exception 'Property is not available' using errcode = '22023';
  end if;
  perform 1 from public.enquiries e where e.id = p_enquiry_id for update;
  select v.id into v_existing from public.property_viewings v
  where v.requested_by = v_user and v.idempotency_key = p_idempotency_key;
  if found then
    if not exists (select 1 from public.property_viewings v
      where v.id = v_existing and v.enquiry_id = p_enquiry_id
        and v.tenancy_cycle_id = p_cycle_id and v.proposed_at = p_proposed_at) then
      raise exception 'Idempotency key already used for another request'
        using errcode = '22023';
    end if;
    return v_existing;
  end if;
  update public.property_viewings v
    set status = 'closed'
    where v.enquiry_id = p_enquiry_id and v.status = 'arranged'
      and v.proposed_at <= pg_catalog.now()
    returning v.id into v_closed_viewing;
  if v_closed_viewing is not null then
    insert into public.property_viewing_events(viewing_id, actor_id, event_type)
      values (v_closed_viewing, v_user, 'viewing_closed');
    perform private.write_audit(v_user, 'viewing_closed',
      'property_viewing', v_closed_viewing, '{}'::jsonb);
  end if;
  insert into public.property_viewings(
    enquiry_id, property_id, landlord_id, tenant_id, tenancy_cycle_id,
    requested_by, idempotency_key, proposed_at
  ) values (
    p_enquiry_id, v_enquiry.property_id, v_enquiry.landlord_id,
    v_enquiry.customer_id, p_cycle_id, v_user, p_idempotency_key, p_proposed_at
  )
  on conflict (requested_by, idempotency_key) do nothing
  returning id into v_viewing;
  if v_viewing is null then
    select v.id into v_existing from public.property_viewings v
    where v.requested_by = v_user and v.idempotency_key = p_idempotency_key;
    if not exists (select 1 from public.property_viewings v
      where v.id = v_existing and v.enquiry_id = p_enquiry_id
        and v.tenancy_cycle_id = p_cycle_id and v.proposed_at = p_proposed_at) then
      raise exception 'Idempotency key already used for another request'
        using errcode = '22023';
    end if;
    return v_existing;
  end if;
  insert into public.property_viewing_events(viewing_id, actor_id, event_type)
    values (v_viewing, v_user, 'created');
  perform private.write_audit(v_user, 'viewing_created', 'property_viewing',
    v_viewing, pg_catalog.jsonb_build_object('cycle_id', p_cycle_id));
  return v_viewing;
end;
$$;
alter function public.create_property_viewing(uuid, uuid, timestamptz, uuid)
  owner to movara_workflow_owner;

create function public.confirm_property_viewing(p_viewing_id uuid)
returns uuid language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_view public.property_viewings%rowtype;
  v_outcome uuid;
  v_setting public.landlord_connection_fee_settings%rowtype;
  v_inserted boolean := false;
begin
  if v_user is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  select * into v_view from public.property_viewings
    where id = p_viewing_id;
  if not found or v_user not in (v_view.tenant_id, v_view.landlord_id) then
    raise exception 'Viewing confirmation not permitted' using errcode = '42501';
  end if;
  perform private.lock_key('cycle:' || v_view.tenancy_cycle_id::text);
  perform private.lock_key('enquiry:' || v_view.enquiry_id::text);
  select * into v_view from public.property_viewings
    where id = p_viewing_id for update;
  if v_view.status = 'arranged'
    and v_view.landlord_confirmed_at is not null
    and v_view.tenant_confirmed_at is not null then
    select id into v_outcome from public.connection_outcomes
      where tenancy_cycle_id = v_view.tenancy_cycle_id;
    return v_outcome;
  end if;
  if v_view.status in ('cancelled', 'closed', 'disputed')
    or v_view.proposed_at <= pg_catalog.now() then
    raise exception 'Viewing cannot be confirmed in its current state'
      using errcode = '22023';
  end if;
  if not exists (select 1 from public.tenancy_search_cycles c
    where c.id = v_view.tenancy_cycle_id and c.status = 'open') then
    raise exception 'Tenancy cycle is closed' using errcode = '22023';
  end if;
  if not exists (select 1 from public.properties p
    where p.id = v_view.property_id and p.landlord_id = v_view.landlord_id
      and p.status = 'published') then
    raise exception 'Property is no longer available' using errcode = '22023';
  end if;
  if v_user = v_view.tenant_id and v_view.tenant_confirmed_at is null then
    update public.property_viewings set tenant_confirmed_at = pg_catalog.now()
      where id = p_viewing_id;
    insert into public.property_viewing_events(viewing_id, actor_id, event_type)
      values (p_viewing_id, v_user, 'tenant_confirmed');
  elsif v_user = v_view.landlord_id and v_view.landlord_confirmed_at is null then
    update public.property_viewings set landlord_confirmed_at = pg_catalog.now()
      where id = p_viewing_id;
    insert into public.property_viewing_events(viewing_id, actor_id, event_type)
      values (p_viewing_id, v_user, 'landlord_confirmed');
  end if;

  select * into v_view from public.property_viewings
    where id = p_viewing_id for update;
  if v_view.landlord_confirmed_at is null or v_view.tenant_confirmed_at is null then
    perform private.write_audit(v_user, 'viewing_party_confirmed',
      'property_viewing', p_viewing_id, '{}'::jsonb);
    return null;
  end if;
  update public.property_viewings set status = 'arranged'
    where id = p_viewing_id and status = 'proposed';

  insert into public.connection_outcomes(
    tenancy_cycle_id, viewing_id, enquiry_id, property_id,
    landlord_id, tenant_id, evidence
  ) values (
    v_view.tenancy_cycle_id, v_view.id, v_view.enquiry_id, v_view.property_id,
    v_view.landlord_id, v_view.tenant_id,
    pg_catalog.jsonb_build_object(
      'trigger', 'mutual_arranged_confirmation',
      'landlord_confirmed_at', v_view.landlord_confirmed_at,
      'tenant_confirmed_at', v_view.tenant_confirmed_at
    )
  )
  on conflict (tenancy_cycle_id) do nothing
  returning id into v_outcome;

  if v_outcome is null then
    select id into v_outcome from public.connection_outcomes
      where tenancy_cycle_id = v_view.tenancy_cycle_id;
    insert into public.property_viewing_events(viewing_id, actor_id, event_type,
      event_data) values (p_viewing_id, v_user, 'existing_cycle_outcome_reused',
      pg_catalog.jsonb_build_object('outcome_id', v_outcome));
  else
    select * into v_setting from public.landlord_connection_fee_settings s
    where s.enabled and s.effective_from <= pg_catalog.now()
      and (s.effective_until is null or s.effective_until > pg_catalog.now())
    order by s.effective_from desc limit 1;
    if found then
      insert into public.landlord_connection_fees(
        connection_outcome_id, viewing_id, landlord_id, fee_setting_id,
        amount_kobo, due_interval_hours, currency, status, due_at
      ) values (
        v_outcome, p_viewing_id, v_view.landlord_id, v_setting.id,
        v_setting.amount_kobo, v_setting.due_interval_hours, 'NGN', 'pending',
        pg_catalog.now() + pg_catalog.make_interval(hours => v_setting.due_interval_hours)
      );
    else
      insert into public.landlord_connection_fees(
        connection_outcome_id, viewing_id, landlord_id
      ) values (v_outcome, p_viewing_id, v_view.landlord_id);
    end if;
    insert into public.property_viewing_events(viewing_id, actor_id, event_type,
      event_data) values (p_viewing_id, v_user, 'connection_outcome_created',
      pg_catalog.jsonb_build_object('outcome_id', v_outcome));
    insert into public.property_viewing_events(viewing_id, actor_id, event_type,
      event_data) values (p_viewing_id, v_user, 'fee_created',
      pg_catalog.jsonb_build_object('outcome_id', v_outcome));
    perform private.write_audit(v_user, 'connection_outcome_created',
      'connection_outcome', v_outcome,
      pg_catalog.jsonb_build_object('viewing_id', p_viewing_id));
  end if;
  insert into public.property_viewing_events(viewing_id, actor_id, event_type)
    values (p_viewing_id, v_user, 'arranged');
  perform private.write_audit(v_user, 'viewing_mutually_confirmed',
    'property_viewing', p_viewing_id,
    pg_catalog.jsonb_build_object('outcome_id', v_outcome));
  return v_outcome;
end;
$$;
alter function public.confirm_property_viewing(uuid)
  owner to movara_workflow_owner;

create function public.cancel_property_viewing(p_viewing_id uuid, p_reason text)
returns void language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_view public.property_viewings%rowtype;
  v_event text;
begin
  select * into v_view from public.property_viewings where id = p_viewing_id;
  if v_user is null or not found
    or v_user not in (v_view.tenant_id, v_view.landlord_id) then
    raise exception 'Cancellation not permitted' using errcode = '42501';
  end if;
  if length(pg_catalog.btrim(coalesce(p_reason, ''))) not between 1 and 2000 then
    raise exception 'Cancellation reason required' using errcode = '22023';
  end if;
  perform private.lock_key('cycle:' || v_view.tenancy_cycle_id::text);
  perform private.lock_key('enquiry:' || v_view.enquiry_id::text);
  select * into v_view from public.property_viewings
    where id = p_viewing_id for update;
  if v_view.status not in ('proposed', 'arranged', 'disputed') then
    raise exception 'Viewing is already inactive' using errcode = '22023';
  end if;
  v_event := case when v_view.landlord_confirmed_at is not null
      and v_view.tenant_confirmed_at is not null
    then 'cancelled_after_confirmation'
    else 'cancelled_before_confirmation' end;
  update public.property_viewings set status = 'cancelled',
    cancelled_at = pg_catalog.now(), cancelled_by = v_user,
    cancellation_reason = p_reason where id = p_viewing_id;
  insert into public.property_viewing_events(viewing_id, actor_id, event_type)
    values (p_viewing_id, v_user, v_event);
  perform private.write_audit(v_user, 'viewing_cancelled',
    'property_viewing', p_viewing_id,
    pg_catalog.jsonb_build_object('reason', p_reason, 'event', v_event));
end;
$$;
alter function public.cancel_property_viewing(uuid, text)
  owner to movara_workflow_owner;

create function public.request_viewing_reschedule(
  p_viewing_id uuid, p_proposed_at timestamptz
)
returns uuid language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_view public.property_viewings%rowtype;
  v_id uuid;
begin
  select * into v_view from public.property_viewings where id = p_viewing_id;
  if v_user is null or not found
    or v_user not in (v_view.tenant_id, v_view.landlord_id)
    or p_proposed_at <= pg_catalog.now()
    or v_view.status <> 'proposed'
    or v_view.tenant_confirmed_at is not null
    or v_view.landlord_confirmed_at is not null then
    raise exception 'Reschedule not permitted' using errcode = '42501';
  end if;
  perform private.lock_key('cycle:' || v_view.tenancy_cycle_id::text);
  perform private.lock_key('enquiry:' || v_view.enquiry_id::text);
  select * into v_view from public.property_viewings
    where id = p_viewing_id for update;
  if v_view.status <> 'proposed' or v_view.tenant_confirmed_at is not null
    or v_view.landlord_confirmed_at is not null then
    raise exception 'Viewing is no longer reschedulable' using errcode = '22023';
  end if;
  insert into public.property_viewing_reschedules(viewing_id, requested_by, proposed_at)
    values (p_viewing_id, v_user, p_proposed_at) returning id into v_id;
  insert into public.property_viewing_events(viewing_id, actor_id, event_type,
    event_data) values (p_viewing_id, v_user, 'reschedule_requested',
      pg_catalog.jsonb_build_object('reschedule_id', v_id));
  perform private.write_audit(v_user, 'viewing_reschedule_requested',
    'property_viewing', p_viewing_id,
    pg_catalog.jsonb_build_object('reschedule_id', v_id));
  return v_id;
end;
$$;
alter function public.request_viewing_reschedule(uuid, timestamptz)
  owner to movara_workflow_owner;

create function public.respond_viewing_reschedule(
  p_reschedule_id uuid, p_accept boolean, p_note text default null
)
returns void language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_change public.property_viewing_reschedules%rowtype;
  v_view public.property_viewings%rowtype;
begin
  select * into v_change from public.property_viewing_reschedules
    where id = p_reschedule_id;
  if not found then
    raise exception 'Reschedule not found' using errcode = '22023';
  end if;
  select * into v_view from public.property_viewings where id = v_change.viewing_id;
  if not found or v_user is null or v_change.status <> 'pending'
    or v_user not in (v_view.tenant_id, v_view.landlord_id)
    or v_user = v_change.requested_by then
    raise exception 'Reschedule response not permitted' using errcode = '42501';
  end if;
  perform private.lock_key('cycle:' || v_view.tenancy_cycle_id::text);
  perform private.lock_key('enquiry:' || v_view.enquiry_id::text);
  select * into v_change from public.property_viewing_reschedules
    where id = p_reschedule_id for update;
  select * into v_view from public.property_viewings
    where id = v_change.viewing_id for update;
  if v_change.status <> 'pending'
    or v_user not in (v_view.tenant_id, v_view.landlord_id)
    or v_user = v_change.requested_by
    or v_view.status <> 'proposed' or v_view.tenant_confirmed_at is not null
    or v_view.landlord_confirmed_at is not null then
    raise exception 'Viewing is no longer reschedulable' using errcode = '22023';
  end if;
  update public.property_viewing_reschedules set
    status = case when p_accept then 'accepted'::public.viewing_reschedule_status
      else 'rejected'::public.viewing_reschedule_status end,
    responded_by = v_user, responded_at = pg_catalog.now(), response_note = p_note
    where id = p_reschedule_id;
  if p_accept then
    update public.property_viewings set proposed_at = v_change.proposed_at,
      landlord_confirmed_at = null, tenant_confirmed_at = null
      where id = v_view.id;
  end if;
  insert into public.property_viewing_events(viewing_id, actor_id, event_type,
    event_data) values (v_view.id, v_user,
      case when p_accept then 'reschedule_accepted' else 'reschedule_rejected' end,
      pg_catalog.jsonb_build_object('reschedule_id', p_reschedule_id));
  perform private.write_audit(v_user, 'viewing_reschedule_responded',
    'property_viewing', v_view.id,
    pg_catalog.jsonb_build_object('accepted', p_accept, 'reschedule_id', p_reschedule_id));
end;
$$;
alter function public.respond_viewing_reschedule(uuid, boolean, text)
  owner to movara_workflow_owner;

create function public.open_next_tenancy_cycle(
  p_property_id uuid, p_landlord_id uuid, p_tenant_id uuid, p_reason text
)
returns uuid language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_number integer;
  v_cycle uuid;
begin
  if v_user is null or not private.has_role('administrator')
    or length(pg_catalog.btrim(coalesce(p_reason, ''))) not between 1 and 2000
    or p_tenant_id = p_landlord_id then
    raise exception 'Cycle creation requires authorized administration'
      using errcode = '42501';
  end if;
  perform private.lock_key('cycle-pair:' || p_property_id::text || ':' ||
    p_landlord_id::text || ':' || p_tenant_id::text);
  if not exists (select 1 from public.properties p
    where p.id = p_property_id and p.landlord_id = p_landlord_id) then
    raise exception 'Property owner mismatch' using errcode = '22023';
  end if;
  if exists (select 1 from public.tenancy_search_cycles c
    where c.property_id = p_property_id and c.landlord_id = p_landlord_id
      and c.tenant_id = p_tenant_id and c.status = 'open') then
    raise exception 'Close the current tenancy cycle first' using errcode = '22023';
  end if;
  select coalesce(max(c.cycle_number), 0) + 1 into v_number
  from public.tenancy_search_cycles c
  where c.property_id = p_property_id and c.landlord_id = p_landlord_id
    and c.tenant_id = p_tenant_id;
  if v_number < 2 then
    raise exception 'Initial cycle is created with the first enquiry'
      using errcode = '22023';
  end if;
  insert into public.tenancy_search_cycles(property_id, landlord_id, tenant_id,
    cycle_number, created_by, authorized_by, authorization_reason)
  values (p_property_id, p_landlord_id, p_tenant_id, v_number,
    v_user, v_user, p_reason) returning id into v_cycle;
  perform private.write_audit(v_user, 'tenancy_cycle_opened',
    'tenancy_search_cycle', v_cycle,
    pg_catalog.jsonb_build_object('cycle_number', v_number, 'reason', p_reason));
  return v_cycle;
end;
$$;
alter function public.open_next_tenancy_cycle(uuid, uuid, uuid, text)
  owner to movara_workflow_owner;

create function public.close_tenancy_cycle(p_cycle_id uuid, p_reason text)
returns void language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null or not private.has_role('administrator')
    or length(pg_catalog.btrim(coalesce(p_reason, ''))) not between 1 and 2000 then
    raise exception 'Cycle closure requires authorized administration'
      using errcode = '42501';
  end if;
  perform private.lock_key('cycle:' || p_cycle_id::text);
  if exists (select 1 from public.property_viewings v
    where v.tenancy_cycle_id = p_cycle_id
      and v.status in ('proposed', 'arranged', 'disputed')) then
    raise exception 'Active viewings must be closed first' using errcode = '22023';
  end if;
  update public.tenancy_search_cycles set status = 'closed',
    closed_at = pg_catalog.now()
    where id = p_cycle_id and status = 'open';
  if not found then
    raise exception 'Open cycle not found' using errcode = '22023';
  end if;
  perform private.write_audit(v_user, 'tenancy_cycle_closed',
    'tenancy_search_cycle', p_cycle_id,
    pg_catalog.jsonb_build_object('reason', p_reason));
end;
$$;
alter function public.close_tenancy_cycle(uuid, text)
  owner to movara_workflow_owner;

create function public.configure_landlord_connection_fee(
  p_amount_kobo bigint, p_effective_from timestamptz,
  p_effective_until timestamptz, p_due_interval_hours integer
)
returns uuid language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_setting uuid;
begin
  if v_user is null or not private.has_role('administrator')
    or p_amount_kobo <= 0 or p_due_interval_hours <= 0
    or p_effective_from is null
    or (p_effective_until is not null and p_effective_until <= p_effective_from) then
    raise exception 'Invalid fee configuration or unauthorized caller'
      using errcode = '42501';
  end if;
  perform private.lock_key('landlord-connection-fee-settings');
  insert into public.landlord_connection_fee_settings(
    amount_kobo, currency, due_interval_hours, effective_from,
    effective_until, created_by
  ) values (
    p_amount_kobo, 'NGN', p_due_interval_hours, p_effective_from,
    p_effective_until, v_user
  ) returning id into v_setting;
  perform private.write_audit(v_user, 'connection_fee_setting_created',
    'landlord_connection_fee_setting', v_setting,
    pg_catalog.jsonb_build_object('amount_kobo', p_amount_kobo,
      'due_interval_hours', p_due_interval_hours,
      'effective_from', p_effective_from, 'effective_until', p_effective_until));
  return v_setting;
end;
$$;
alter function public.configure_landlord_connection_fee(bigint, timestamptz,
  timestamptz, integer) owner to movara_workflow_owner;

create function public.end_landlord_connection_fee_setting(
  p_setting_id uuid, p_effective_until timestamptz, p_reason text
)
returns void language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_setting public.landlord_connection_fee_settings%rowtype;
begin
  if v_user is null or not private.has_role('administrator')
    or p_effective_until <= pg_catalog.now()
    or length(pg_catalog.btrim(coalesce(p_reason, ''))) not between 1 and 2000 then
    raise exception 'Fee setting update not permitted' using errcode = '42501';
  end if;
  perform private.lock_key('landlord-connection-fee-settings');
  select * into v_setting from public.landlord_connection_fee_settings
    where id = p_setting_id and enabled for update;
  if not found or p_effective_until <= v_setting.effective_from
    or (v_setting.effective_until is not null
      and p_effective_until >= v_setting.effective_until) then
    raise exception 'Fee setting period cannot be shortened to that date'
      using errcode = '22023';
  end if;
  update public.landlord_connection_fee_settings
    set effective_until = p_effective_until where id = p_setting_id;
  perform private.write_audit(v_user, 'connection_fee_setting_ended',
    'landlord_connection_fee_setting', p_setting_id,
    pg_catalog.jsonb_build_object('effective_until', p_effective_until,
      'reason', p_reason));
end;
$$;
alter function public.end_landlord_connection_fee_setting(uuid, timestamptz, text)
  owner to movara_workflow_owner;

create function public.disable_future_landlord_connection_fee_setting(
  p_setting_id uuid, p_reason text
)
returns void language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_setting public.landlord_connection_fee_settings%rowtype;
begin
  if v_user is null or not private.has_role('administrator')
    or length(pg_catalog.btrim(coalesce(p_reason, ''))) not between 1 and 2000 then
    raise exception 'Fee setting update not permitted' using errcode = '42501';
  end if;
  perform private.lock_key('landlord-connection-fee-settings');
  select * into v_setting from public.landlord_connection_fee_settings
    where id = p_setting_id for update;
  if not found or not v_setting.enabled
    or v_setting.effective_from <= pg_catalog.now() then
    raise exception 'Only an enabled future setting can be disabled'
      using errcode = '22023';
  end if;
  update public.landlord_connection_fee_settings
    set enabled = false where id = p_setting_id;
  perform private.write_audit(v_user, 'connection_fee_setting_disabled',
    'landlord_connection_fee_setting', p_setting_id,
    pg_catalog.jsonb_build_object('reason', p_reason));
end;
$$;
alter function public.disable_future_landlord_connection_fee_setting(
  uuid, text) owner to movara_workflow_owner;

create function public.assign_fee_configuration(
  p_fee_id uuid, p_setting_id uuid
)
returns void language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_fee public.landlord_connection_fees%rowtype;
  v_setting public.landlord_connection_fee_settings%rowtype;
begin
  if v_user is null or not private.has_role('administrator') then
    raise exception 'Administrator required' using errcode = '42501';
  end if;
  select * into v_fee from public.landlord_connection_fees
    where id = p_fee_id for update;
  if not found then
    raise exception 'Fee not found' using errcode = '22023';
  end if;
  select * into v_setting from public.landlord_connection_fee_settings
    where id = p_setting_id and enabled
      and effective_from <= pg_catalog.now()
      and (effective_until is null or effective_until > pg_catalog.now());
  if not found or v_fee.status <> 'awaiting_configuration' then
    raise exception 'Fee or effective configuration unavailable' using errcode = '22023';
  end if;
  update public.landlord_connection_fees set fee_setting_id = v_setting.id,
    amount_kobo = v_setting.amount_kobo,
    due_interval_hours = v_setting.due_interval_hours,
    due_at = pg_catalog.now() +
      pg_catalog.make_interval(hours => v_setting.due_interval_hours),
    status = 'pending'
    where id = p_fee_id;
  perform private.write_audit(v_user, 'connection_fee_configured',
    'landlord_connection_fee', p_fee_id,
    pg_catalog.jsonb_build_object('setting_id', p_setting_id,
      'amount_kobo', v_setting.amount_kobo));
  insert into public.property_viewing_events(viewing_id, actor_id, event_type,
    event_data)
  values (v_fee.viewing_id, v_user, 'fee_configuration_assigned',
    pg_catalog.jsonb_build_object('fee_id', p_fee_id, 'setting_id', p_setting_id));
end;
$$;
alter function public.assign_fee_configuration(uuid, uuid)
  owner to movara_workflow_owner;

create function public.open_connection_fee_dispute(
  p_fee_id uuid, p_reason text
)
returns uuid language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_fee public.landlord_connection_fees%rowtype;
  v_outcome public.connection_outcomes%rowtype;
  v_view public.property_viewings%rowtype;
  v_dispute uuid;
begin
  select * into v_fee from public.landlord_connection_fees
    where id = p_fee_id;
  if not found then
    raise exception 'Fee not found' using errcode = '22023';
  end if;
  select * into v_outcome from public.connection_outcomes
    where id = v_fee.connection_outcome_id;
  if not found or v_user is null
    or v_user not in (v_outcome.tenant_id, v_fee.landlord_id)
    or v_fee.status not in ('pending', 'overdue', 'failed')
    or length(pg_catalog.btrim(coalesce(p_reason, ''))) not between 1 and 5000 then
    raise exception 'Fee dispute not permitted' using errcode = '42501';
  end if;
  perform private.lock_key('cycle:' || v_outcome.tenancy_cycle_id::text);
  select * into v_view from public.property_viewings
    where id = v_fee.viewing_id;
  perform private.lock_key('enquiry:' || v_view.enquiry_id::text);
  select * into v_fee from public.landlord_connection_fees
    where id = p_fee_id for update;
  if v_fee.status not in ('pending', 'overdue', 'failed') then
    raise exception 'Fee dispute not permitted' using errcode = '42501';
  end if;
  insert into public.disputes(opened_by, property_viewing_id,
    landlord_fee_id, reason)
  values (v_user, v_fee.viewing_id, v_fee.id, p_reason)
  returning id into v_dispute;
  update public.landlord_connection_fees set status = 'disputed'
    where id = p_fee_id;
  update public.connection_outcomes set status = 'disputed'
    where id = v_outcome.id;
  update public.property_viewings set status = 'disputed'
    where id = v_fee.viewing_id and status = 'arranged';
  insert into public.property_viewing_events(viewing_id, actor_id, event_type,
    event_data) values (v_fee.viewing_id, v_user, 'dispute_opened',
      pg_catalog.jsonb_build_object('dispute_id', v_dispute, 'reason', p_reason));
  perform private.write_audit(v_user, 'connection_fee_disputed',
    'landlord_connection_fee', p_fee_id,
    pg_catalog.jsonb_build_object('dispute_id', v_dispute, 'reason', p_reason));
  return v_dispute;
end;
$$;
alter function public.open_connection_fee_dispute(uuid, text)
  owner to movara_workflow_owner;

create function public.resolve_connection_fee_dispute(
  p_dispute_id uuid, p_waive_fee boolean, p_resolution text
)
returns void language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_dispute public.disputes%rowtype;
  v_fee public.landlord_connection_fees%rowtype;
  v_view public.property_viewings%rowtype;
  v_cycle_id uuid;
  v_enquiry_id uuid;
  v_outcome uuid;
begin
  if v_user is null or not private.has_role('administrator')
    or length(pg_catalog.btrim(coalesce(p_resolution, ''))) not between 1 and 5000 then
    raise exception 'Dispute resolution requires authorized administration'
      using errcode = '42501';
  end if;
  select * into v_dispute from public.disputes
    where id = p_dispute_id and landlord_fee_id is not null;
  if not found or v_dispute.status not in ('opened', 'reviewing') then
    raise exception 'Active fee dispute not found' using errcode = '22023';
  end if;
  select * into v_fee from public.landlord_connection_fees
    where id = v_dispute.landlord_fee_id;
  select tenancy_cycle_id into v_cycle_id from public.connection_outcomes
    where id = v_fee.connection_outcome_id;
  select enquiry_id into v_enquiry_id from public.property_viewings
    where id = v_fee.viewing_id;
  perform private.lock_key('cycle:' || v_cycle_id::text);
  perform private.lock_key('enquiry:' || v_enquiry_id::text);
  select * into v_dispute from public.disputes
    where id = p_dispute_id and landlord_fee_id is not null for update;
  if not found or v_dispute.status not in ('opened', 'reviewing') then
    raise exception 'Active fee dispute not found' using errcode = '22023';
  end if;
  select * into v_fee from public.landlord_connection_fees
    where id = v_dispute.landlord_fee_id for update;
  select * into v_view from public.property_viewings
    where id = v_fee.viewing_id for update;
  v_outcome := v_fee.connection_outcome_id;
  update public.disputes set status = 'resolved', resolution = p_resolution,
    resolved_by = v_user, resolved_at = pg_catalog.now()
    where id = p_dispute_id;
  if p_waive_fee then
    update public.landlord_connection_fees set status = 'waived',
      waived_at = pg_catalog.now(), waived_by = v_user, waiver_reason = p_resolution
      where id = v_fee.id;
    update public.connection_outcomes set status = 'waived' where id = v_outcome;
  else
    update public.landlord_connection_fees set status =
      case when due_at < pg_catalog.now() then 'overdue'::public.landlord_connection_fee_status
        else 'pending'::public.landlord_connection_fee_status end
      where id = v_fee.id;
    update public.connection_outcomes set status = 'fee_eligible' where id = v_outcome;
  end if;
  update public.property_viewings set status = 'arranged'
    where id = v_fee.viewing_id and status = 'disputed';
  insert into public.property_viewing_events(viewing_id, actor_id, event_type,
    event_data) values (v_fee.viewing_id, v_user, 'dispute_resolved',
      pg_catalog.jsonb_build_object('dispute_id', p_dispute_id,
        'waived', p_waive_fee, 'resolution', p_resolution));
  if p_waive_fee then
    insert into public.property_viewing_events(viewing_id, actor_id, event_type,
      event_data) values (v_fee.viewing_id, v_user, 'fee_waived',
        pg_catalog.jsonb_build_object('fee_id', v_fee.id, 'reason', p_resolution));
  end if;
  perform private.write_audit(v_user, 'connection_fee_dispute_resolved',
    'landlord_connection_fee', v_fee.id,
    pg_catalog.jsonb_build_object('dispute_id', p_dispute_id,
      'waived', p_waive_fee, 'resolution', p_resolution));
  if p_waive_fee then
    perform private.write_audit(v_user, 'landlord_connection_fee_waived',
      'landlord_connection_fee', v_fee.id,
      pg_catalog.jsonb_build_object('dispute_id', p_dispute_id,
        'reason', p_resolution));
  end if;
end;
$$;
alter function public.resolve_connection_fee_dispute(uuid, boolean, text)
  owner to movara_workflow_owner;

-- The Edge Function must verify provider signatures before this RPC. The
-- function independently enforces the trusted service-role JWT, expected
-- landlord/amount/currency, pending state, and event idempotency.
create function public.prepare_landlord_fee_payment(p_fee_id uuid)
returns jsonb language plpgsql security definer
set search_path = ''
as $$
declare
  v_fee public.landlord_connection_fees%rowtype;
  v_jwt_role text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  );
begin
  if v_jwt_role <> 'service_role' then
    raise exception 'Trusted payment service required' using errcode = '42501';
  end if;
  select * into v_fee from public.landlord_connection_fees
    where id = p_fee_id for update;
  if not found or v_fee.status not in ('pending', 'overdue', 'failed')
    or exists (select 1 from public.disputes d
      where d.landlord_fee_id = p_fee_id and d.status in ('opened', 'reviewing')) then
    raise exception 'Fee is not collectible' using errcode = '22023';
  end if;
  perform private.write_audit(null, 'landlord_connection_fee_payment_preflight',
    'landlord_connection_fee', p_fee_id,
    pg_catalog.jsonb_build_object('payer_id', v_fee.landlord_id,
      'amount_kobo', v_fee.amount_kobo, 'currency', v_fee.currency));
  return pg_catalog.jsonb_build_object(
    'fee_id', v_fee.id,
    'payer_id', v_fee.landlord_id,
    'amount_kobo', v_fee.amount_kobo,
    'currency', v_fee.currency,
    'due_at', v_fee.due_at
  );
end;
$$;
alter function public.prepare_landlord_fee_payment(uuid)
  owner to movara_workflow_owner;

create function public.record_verified_fee_payment(
  p_fee_id uuid, p_provider text, p_provider_reference text,
  p_provider_event_id text, p_amount_kobo bigint, p_currency char(3)
)
returns uuid language plpgsql security definer
set search_path = ''
as $$
declare
  v_fee public.landlord_connection_fees%rowtype;
  v_payment uuid;
  v_prior public.payments%rowtype;
  v_jwt_role text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  );
begin
  if v_jwt_role <> 'service_role' then
    raise exception 'Trusted payment service required' using errcode = '42501';
  end if;
  if p_provider is null or length(trim(p_provider)) = 0
    or p_provider_reference is null or length(trim(p_provider_reference)) = 0
    or p_provider_event_id is null or length(trim(p_provider_event_id)) = 0 then
    raise exception 'Provider references are required' using errcode = '22023';
  end if;
  select * into v_fee from public.landlord_connection_fees
    where id = p_fee_id for update;
  if not found then
    raise exception 'Fee not found' using errcode = '22023';
  end if;
  select * into v_prior from public.payments
    where provider = p_provider and provider_event_id = p_provider_event_id;
  if found then
    if v_prior.landlord_fee_id <> p_fee_id
      or v_prior.provider_reference <> p_provider_reference
      or v_prior.amount_kobo <> p_amount_kobo or v_prior.currency <> p_currency
      or v_prior.status <> 'succeeded' then
      raise exception 'Provider event idempotency mismatch' using errcode = '22023';
    end if;
    return v_prior.id;
  end if;
  if v_fee.status not in ('pending', 'overdue', 'failed')
    or v_fee.amount_kobo <> p_amount_kobo or v_fee.currency <> p_currency
    or p_currency <> 'NGN' then
    raise exception 'Fee is not payable or payment amount mismatches'
      using errcode = '22023';
  end if;
  insert into public.payments(
    payer_id, amount_kobo, currency, status, provider,
    provider_reference, provider_event_id, landlord_fee_id
  ) values (
    v_fee.landlord_id, p_amount_kobo, p_currency, 'succeeded',
    p_provider, p_provider_reference, p_provider_event_id, p_fee_id
  ) returning id into v_payment;
  update public.landlord_connection_fees set status = 'paid',
    paid_at = pg_catalog.now(), payment_reference = p_provider_reference
    where id = p_fee_id;
  insert into public.property_viewing_events(viewing_id, actor_id, event_type,
    event_data) values (v_fee.viewing_id, null, 'fee_paid',
      pg_catalog.jsonb_build_object('payment_id', v_payment,
        'provider_reference', p_provider_reference));
  perform private.write_audit(null, 'landlord_connection_fee_paid',
    'landlord_connection_fee', p_fee_id,
    pg_catalog.jsonb_build_object('payment_id', v_payment,
      'provider_event_id', p_provider_event_id));
  return v_payment;
end;
$$;
alter function public.record_verified_fee_payment(
  uuid, text, text, text, bigint, character
) owner to movara_workflow_owner;

create function public.record_failed_fee_payment(
  p_fee_id uuid, p_provider text, p_provider_reference text,
  p_provider_event_id text, p_amount_kobo bigint, p_currency char(3),
  p_failure_code text
)
returns uuid language plpgsql security definer
set search_path = ''
as $$
declare
  v_fee public.landlord_connection_fees%rowtype;
  v_payment uuid;
  v_prior public.payments%rowtype;
  v_jwt_role text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  );
begin
  if v_jwt_role <> 'service_role' then
    raise exception 'Trusted payment service required' using errcode = '42501';
  end if;
  if p_provider is null or length(trim(p_provider)) = 0
    or p_provider_reference is null or length(trim(p_provider_reference)) = 0
    or p_provider_event_id is null or length(trim(p_provider_event_id)) = 0
    or length(trim(coalesce(p_failure_code, ''))) not between 1 and 200 then
    raise exception 'Verified failure details are required' using errcode = '22023';
  end if;
  select * into v_fee from public.landlord_connection_fees
    where id = p_fee_id for update;
  if not found then
    raise exception 'Fee not found' using errcode = '22023';
  end if;
  select * into v_prior from public.payments
    where provider = p_provider and provider_event_id = p_provider_event_id;
  if found then
    if v_prior.landlord_fee_id <> p_fee_id
      or v_prior.provider_reference <> p_provider_reference
      or v_prior.amount_kobo <> p_amount_kobo
      or v_prior.currency <> p_currency or v_prior.status <> 'failed' then
      raise exception 'Provider event idempotency mismatch' using errcode = '22023';
    end if;
    return v_prior.id;
  end if;
  if v_fee.status not in ('pending', 'overdue', 'failed')
    or v_fee.amount_kobo <> p_amount_kobo or v_fee.currency <> p_currency
    or p_currency <> 'NGN' then
    raise exception 'Fee is not payable or payment amount mismatches'
      using errcode = '22023';
  end if;
  insert into public.payments(
    payer_id, amount_kobo, currency, status, provider,
    provider_reference, provider_event_id, landlord_fee_id
  ) values (
    v_fee.landlord_id, p_amount_kobo, p_currency, 'failed',
    p_provider, p_provider_reference, p_provider_event_id, p_fee_id
  ) returning id into v_payment;
  update public.landlord_connection_fees set status = 'failed'
    where id = p_fee_id;
  insert into public.property_viewing_events(viewing_id, actor_id, event_type,
    event_data) values (v_fee.viewing_id, null, 'fee_payment_failed',
      pg_catalog.jsonb_build_object('payment_id', v_payment,
        'provider_reference', p_provider_reference,
        'failure_code', p_failure_code));
  perform private.write_audit(null, 'landlord_connection_fee_payment_failed',
    'landlord_connection_fee', p_fee_id,
    pg_catalog.jsonb_build_object('payment_id', v_payment,
      'provider_event_id', p_provider_event_id,
      'failure_code', p_failure_code));
  return v_payment;
end;
$$;
alter function public.record_failed_fee_payment(
  uuid, text, text, text, bigint, character, text
) owner to movara_workflow_owner;

create function public.provision_user_role(
  p_user_id uuid, p_role public.app_role, p_reason text
)
returns void language plpgsql security definer
set search_path = ''
as $$
declare
  v_role text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  );
begin
  if v_role <> 'service_role'
    or length(pg_catalog.btrim(coalesce(p_reason, ''))) not between 1 and 2000 then
    raise exception 'Trusted role provisioning required' using errcode = '42501';
  end if;
  if p_role = 'driver' and not exists (
    select 1 from public.driver_verifications d
    where d.driver_id = p_user_id and d.status = 'approved'
  ) then
    raise exception 'Driver approval required' using errcode = '42501';
  end if;
  if p_role = 'landlord' and not exists (
    select 1 from public.landlord_verifications l
    where l.landlord_id = p_user_id and l.status = 'approved'
  ) then
    raise exception 'Landlord identity verification required' using errcode = '42501';
  end if;
  insert into public.user_roles(user_id, role, granted_by)
    values (p_user_id, p_role, null) on conflict do nothing;
  perform private.write_audit(null, 'user_role_provisioned',
    'user_role', p_user_id,
    pg_catalog.jsonb_build_object('role', p_role::text, 'reason', p_reason));
end;
$$;
alter function public.provision_user_role(uuid, public.app_role, text)
  owner to movara_workflow_owner;

create function public.register_property_image(
  p_property_id uuid, p_image_id uuid, p_sort_order smallint default 0
)
returns text language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_path text;
begin
  if v_user is null or p_sort_order < 0
    or not exists (select 1 from public.properties p
      where p.id = p_property_id and p.landlord_id = v_user) then
    raise exception 'Property image registration not permitted'
      using errcode = '42501';
  end if;
  v_path := p_property_id::text || '/' || v_user::text || '/' ||
    p_image_id::text;
  insert into public.property_images(
    id, property_id, landlord_id, object_path, sort_order
  ) values (p_image_id, p_property_id, v_user, v_path, p_sort_order);
  return v_path;
end;
$$;
alter function public.register_property_image(uuid, uuid, smallint)
  owner to movara_workflow_owner;

create function public.register_driver_document(
  p_document_id uuid, p_document_type text
)
returns text language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_path text;
begin
  if v_user is null or length(pg_catalog.btrim(coalesce(p_document_type, ''))) not between 1 and 100
    or not exists (select 1 from public.role_requests r
      where r.user_id = v_user and r.requested_role = 'driver'
        and r.status in ('pending', 'approved')) then
    raise exception 'Driver document registration not permitted'
      using errcode = '42501';
  end if;
  v_path := v_user::text || '/' || p_document_id::text || '/document';
  insert into public.driver_documents(driver_id, id, document_type, object_path)
    values (v_user, p_document_id, p_document_type, v_path);
  return v_path;
end;
$$;
alter function public.register_driver_document(uuid, text)
  owner to movara_workflow_owner;

create function public.register_landlord_document(
  p_document_id uuid, p_document_type text
)
returns text language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_path text;
begin
  if v_user is null
    or length(pg_catalog.btrim(coalesce(p_document_type, ''))) not between 1 and 100
    or not exists (select 1 from public.role_requests r
      where r.user_id = v_user and r.requested_role = 'landlord'
        and r.status in ('pending', 'approved')) then
    raise exception 'Landlord document registration not permitted'
      using errcode = '42501';
  end if;
  v_path := v_user::text || '/' || p_document_id::text || '/document';
  insert into public.landlord_documents(
    landlord_id, id, document_type, object_path
  ) values (v_user, p_document_id, p_document_type, v_path);
  return v_path;
end;
$$;
alter function public.register_landlord_document(uuid, text)
  owner to movara_workflow_owner;

create function public.admin_review_identity(
  p_subject_type text, p_subject_id uuid,
  p_status public.verification_status, p_reason text
)
returns void language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_prior public.verification_status;
  v_subject uuid;
begin
  if v_user is null or not private.has_role('administrator')
    or p_status not in ('approved', 'rejected', 'suspended')
    or length(pg_catalog.btrim(coalesce(p_reason, ''))) not between 1 and 2000 then
    raise exception 'Verification review not permitted' using errcode = '42501';
  end if;
  if p_subject_type = 'driver' then
    select status into v_prior from public.driver_verifications
      where driver_id = p_subject_id for update;
    if not found then raise exception 'Driver verification not found'; end if;
    update public.driver_verifications set status = p_status,
      reviewed_at = pg_catalog.now(), reviewed_by = v_user,
      updated_at = pg_catalog.now() where driver_id = p_subject_id;
    v_subject := p_subject_id;
    if p_status = 'approved' then
      update public.role_requests set status = 'approved', updated_at = pg_catalog.now()
        where user_id = p_subject_id and requested_role = 'driver';
      insert into public.user_roles(user_id, role, granted_by)
        values (p_subject_id, 'driver', v_user) on conflict do nothing;
    else
      update public.role_requests set status = p_status, updated_at = pg_catalog.now()
        where user_id = p_subject_id and requested_role = 'driver';
      delete from public.user_roles where user_id = p_subject_id and role = 'driver';
    end if;
  elsif p_subject_type = 'landlord' then
    select status into v_prior from public.landlord_verifications
      where landlord_id = p_subject_id for update;
    if not found then raise exception 'Landlord verification not found'; end if;
    update public.landlord_verifications set status = p_status,
      reviewed_at = pg_catalog.now(), reviewed_by = v_user,
      updated_at = pg_catalog.now() where landlord_id = p_subject_id;
    v_subject := p_subject_id;
    if p_status = 'approved' then
      update public.role_requests set status = 'approved', updated_at = pg_catalog.now()
        where user_id = p_subject_id and requested_role = 'landlord';
      insert into public.user_roles(user_id, role, granted_by)
        values (p_subject_id, 'landlord', v_user) on conflict do nothing;
    else
      update public.role_requests set status = p_status, updated_at = pg_catalog.now()
        where user_id = p_subject_id and requested_role = 'landlord';
      delete from public.user_roles where user_id = p_subject_id and role = 'landlord';
      update public.properties set status = 'paused'
        where landlord_id = p_subject_id and status = 'published';
    end if;
  elsif p_subject_type = 'document' then
    select driver_id, verification into v_subject, v_prior
      from public.driver_documents where id = p_subject_id for update;
    if found then
      update public.driver_documents set verification = p_status,
        reviewed_at = pg_catalog.now(), reviewed_by = v_user
        where id = p_subject_id;
    else
      select landlord_id, verification into v_subject, v_prior
        from public.landlord_documents where id = p_subject_id for update;
      if not found then raise exception 'Identity document not found'; end if;
      update public.landlord_documents set verification = p_status,
        reviewed_at = pg_catalog.now(), reviewed_by = v_user
        where id = p_subject_id;
    end if;
  elsif p_subject_type = 'vehicle' then
    select driver_id, verification into v_subject, v_prior
      from public.vehicles where id = p_subject_id for update;
    if not found then raise exception 'Vehicle not found'; end if;
    if p_status = 'approved' and not exists (
      select 1 from public.driver_verifications d
      where d.driver_id = v_subject and d.status = 'approved'
    ) then
      raise exception 'Driver must be approved before vehicle verification'
        using errcode = '22023';
    end if;
    update public.vehicles set verification = p_status,
      reviewed_at = pg_catalog.now(), reviewed_by = v_user
      where id = p_subject_id;
  else
    raise exception 'Unsupported identity subject type' using errcode = '22023';
  end if;
  insert into public.verification_audit_logs(
    actor_id, subject_id, subject_type, subject_entity_id,
    prior_status, new_status, reason
  ) values (v_user, v_subject, p_subject_type, p_subject_id,
    v_prior, p_status, p_reason);
  perform private.write_audit(v_user, 'identity_verification_reviewed',
    p_subject_type, p_subject_id,
    pg_catalog.jsonb_build_object('status', p_status::text, 'reason', p_reason));
end;
$$;
alter function public.admin_review_identity(
  text, uuid, public.verification_status, text
) owner to movara_workflow_owner;

create function public.admin_review_property(
  p_property_id uuid, p_status public.verification_status, p_reason text
)
returns void language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_owner uuid;
  v_prior public.verification_status;
  v_listing public.listing_status;
begin
  if v_user is null or not private.has_role('administrator')
    or p_status not in ('approved', 'rejected', 'suspended')
    or length(pg_catalog.btrim(coalesce(p_reason, ''))) not between 1 and 2000 then
    raise exception 'Property review not permitted' using errcode = '42501';
  end if;
  select landlord_id, verification, status into v_owner, v_prior, v_listing
    from public.properties where id = p_property_id for update;
  if not found then raise exception 'Property not found'; end if;
  if p_status = 'approved' and not exists (
    select 1 from public.landlord_verifications l
    where l.landlord_id = v_owner and l.status = 'approved'
  ) then
    raise exception 'Landlord identity verification must be approved first'
      using errcode = '22023';
  end if;
  insert into public.property_verifications(property_id, status, reviewed_at,
    reviewed_by, updated_at)
  values (p_property_id, p_status, pg_catalog.now(), v_user, pg_catalog.now())
  on conflict (property_id) do update set status = excluded.status,
    reviewed_at = excluded.reviewed_at, reviewed_by = excluded.reviewed_by,
    updated_at = excluded.updated_at;
  update public.properties set verification = p_status,
    status = case
      when p_status = 'approved' and v_listing = 'pending_review'
        then 'published'::public.listing_status
      when p_status = 'rejected' then 'rejected'::public.listing_status
      when p_status = 'suspended' then 'paused'::public.listing_status
      else status end
    where id = p_property_id;
  insert into public.verification_audit_logs(
    actor_id, subject_id, subject_type, subject_entity_id,
    prior_status, new_status, reason
  ) values (v_user, v_owner, 'property', p_property_id,
    v_prior, p_status, p_reason);
  perform private.write_audit(v_user, 'property_verification_reviewed',
    'property', p_property_id,
    pg_catalog.jsonb_build_object('status', p_status::text, 'reason', p_reason));
end;
$$;
alter function public.admin_review_property(
  uuid, public.verification_status, text
) owner to movara_workflow_owner;

revoke movara_workflow_owner from postgres;
revoke create on schema public, private from movara_workflow_owner;

-- Every client-callable definer function is owned by the constrained role,
-- uses an empty search_path, and has explicit execution grants.
revoke all on function private.lock_key(text) from public, anon, authenticated;
revoke all on function private.write_audit(uuid, text, text, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function private.lock_key(text),
  private.write_audit(uuid, text, text, uuid, jsonb) to movara_workflow_owner;

revoke all on function public.request_marketplace_role(public.app_role)
  from public, anon;
revoke all on function public.create_enquiry(uuid, text, uuid) from public, anon;
revoke all on function public.send_enquiry_message(uuid, text, uuid)
  from public, anon;
revoke all on function public.create_property_viewing(uuid, uuid, timestamptz, uuid)
  from public, anon;
revoke all on function public.confirm_property_viewing(uuid) from public, anon;
revoke all on function public.cancel_property_viewing(uuid, text) from public, anon;
revoke all on function public.request_viewing_reschedule(uuid, timestamptz)
  from public, anon;
revoke all on function public.respond_viewing_reschedule(uuid, boolean, text)
  from public, anon;
revoke all on function public.open_next_tenancy_cycle(uuid, uuid, uuid, text)
  from public, anon;
revoke all on function public.close_tenancy_cycle(uuid, text) from public, anon;
revoke all on function public.configure_landlord_connection_fee(
  bigint, timestamptz, timestamptz, integer) from public, anon;
revoke all on function public.end_landlord_connection_fee_setting(
  uuid, timestamptz, text) from public, anon;
revoke all on function public.disable_future_landlord_connection_fee_setting(
  uuid, text) from public, anon;
revoke all on function public.assign_fee_configuration(uuid, uuid) from public, anon;
revoke all on function public.open_connection_fee_dispute(uuid, text)
  from public, anon;
revoke all on function public.resolve_connection_fee_dispute(uuid, boolean, text)
  from public, anon;
revoke all on function public.record_verified_fee_payment(
  uuid, text, text, text, bigint, character) from public, anon, authenticated;
revoke all on function public.prepare_landlord_fee_payment(uuid)
  from public, anon, authenticated;
revoke all on function public.record_failed_fee_payment(
  uuid, text, text, text, bigint, character, text)
  from public, anon, authenticated;
revoke all on function public.provision_user_role(uuid, public.app_role, text)
  from public, anon, authenticated;
revoke all on function public.register_property_image(uuid, uuid, smallint)
  from public, anon;
revoke all on function public.register_driver_document(uuid, text)
  from public, anon;
revoke all on function public.register_landlord_document(uuid, text)
  from public, anon;
revoke all on function public.admin_review_identity(
  text, uuid, public.verification_status, text) from public, anon;
revoke all on function public.admin_review_property(
  uuid, public.verification_status, text) from public, anon;

grant execute on function public.request_marketplace_role(public.app_role),
  public.create_enquiry(uuid, text, uuid),
  public.send_enquiry_message(uuid, text, uuid),
  public.create_property_viewing(uuid, uuid, timestamptz, uuid),
  public.confirm_property_viewing(uuid),
  public.cancel_property_viewing(uuid, text),
  public.request_viewing_reschedule(uuid, timestamptz),
  public.respond_viewing_reschedule(uuid, boolean, text),
  public.open_next_tenancy_cycle(uuid, uuid, uuid, text),
  public.close_tenancy_cycle(uuid, text),
  public.configure_landlord_connection_fee(bigint, timestamptz, timestamptz, integer),
  public.end_landlord_connection_fee_setting(uuid, timestamptz, text),
  public.disable_future_landlord_connection_fee_setting(uuid, text),
  public.assign_fee_configuration(uuid, uuid),
  public.open_connection_fee_dispute(uuid, text),
  public.resolve_connection_fee_dispute(uuid, boolean, text),
  public.register_property_image(uuid, uuid, smallint),
  public.register_driver_document(uuid, text),
  public.register_landlord_document(uuid, text),
  public.admin_review_identity(text, uuid, public.verification_status, text),
  public.admin_review_property(uuid, public.verification_status, text)
to authenticated;
grant execute on function public.record_verified_fee_payment(
  uuid, text, text, text, bigint, character
) to service_role;
grant execute on function public.prepare_landlord_fee_payment(uuid)
  to service_role;
grant execute on function public.record_failed_fee_payment(
  uuid, text, text, text, bigint, character, text
) to service_role;
grant execute on function public.provision_user_role(
  uuid, public.app_role, text
) to service_role;

-- Bucket paths: property-images/{property_uuid}/{landlord_uuid}/{image_uuid}
-- and identity-documents/{owner_uuid}/{document_uuid}/document.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('property-images', 'property-images', false, 10485760,
  array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false;
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('identity-documents', 'identity-documents', false, 10485760,
  array['image/jpeg','image/png','application/pdf'])
on conflict (id) do update set public = false;

create policy property_image_object_read on storage.objects
  for select to anon, authenticated using (
    bucket_id = 'property-images' and exists (
      select 1 from public.properties p
      where p.id::text = split_part(name, '/', 1)
        and p.landlord_id::text = split_part(name, '/', 2)
        and (p.status = 'published'
          or p.landlord_id = (select auth.uid())
          or (select private.has_role('administrator')))
    )
  );
create policy property_image_object_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'property-images'
    and split_part(name, '/', 2) = (select auth.uid())::text
    and exists (select 1 from public.properties p
      where p.id::text = split_part(name, '/', 1)
        and p.landlord_id = (select auth.uid()))
    and exists (select 1 from public.property_images i
      where i.object_path = name and i.landlord_id = (select auth.uid()))
  );
create policy property_image_object_delete on storage.objects
  for delete to authenticated using (
    bucket_id = 'property-images'
    and split_part(name, '/', 2) = (select auth.uid())::text
    and exists (select 1 from public.properties p
      where p.id::text = split_part(name, '/', 1)
        and p.landlord_id = (select auth.uid()))
  );
create policy identity_document_object_read on storage.objects
  for select to authenticated using (
    bucket_id = 'identity-documents'
    and (split_part(name, '/', 1) = (select auth.uid())::text
      or (select private.has_role('administrator')))
    and exists (select 1 from public.driver_documents d
      where d.object_path = name
        and (d.driver_id = (select auth.uid())
          or (select private.has_role('administrator'))))
    or bucket_id = 'identity-documents'
      and exists (select 1 from public.landlord_documents l
        where l.object_path = name
          and (l.landlord_id = (select auth.uid())
            or (select private.has_role('administrator'))))
  );
create policy identity_document_object_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'identity-documents'
    and split_part(name, '/', 1) = (select auth.uid())::text
    and exists (select 1 from public.driver_documents d
      where d.object_path = name and d.driver_id = (select auth.uid()))
    or bucket_id = 'identity-documents'
      and split_part(name, '/', 1) = (select auth.uid())::text
      and exists (select 1 from public.landlord_documents l
        where l.object_path = name and l.landlord_id = (select auth.uid()))
  );
create policy identity_document_object_delete on storage.objects
  for delete to authenticated using (
    bucket_id = 'identity-documents'
    and split_part(name, '/', 1) = (select auth.uid())::text
    and exists (select 1 from public.driver_documents d
      where d.object_path = name and d.driver_id = (select auth.uid())
        and d.verification <> 'approved')
    or bucket_id = 'identity-documents'
      and split_part(name, '/', 1) = (select auth.uid())::text
      and exists (select 1 from public.landlord_documents l
        where l.object_path = name and l.landlord_id = (select auth.uid())
          and l.verification <> 'approved')
  );
