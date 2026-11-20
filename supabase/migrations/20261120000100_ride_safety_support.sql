-- Rider safety, trip sharing, support, and post-trip feedback.
grant movara_workflow_owner to postgres with set true, inherit false;
grant create on schema public to movara_workflow_owner;
create or replace function private.current_user_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select auth.uid();
$$;
revoke all on function private.current_user_id() from public,anon,authenticated;
grant execute on function private.current_user_id() to movara_workflow_owner;
grant usage on schema private to movara_workflow_owner;

create table public.emergency_contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 100),
  phone text not null check (length(btrim(phone)) between 7 and 32),
  relationship text not null default '' check (length(relationship) <= 60),
  created_at timestamptz not null default now()
);
create index emergency_contacts_user_idx on public.emergency_contacts(user_id, created_at);
alter table public.emergency_contacts enable row level security;
grant select, insert, update, delete on public.emergency_contacts to authenticated;
create policy emergency_contacts_self on public.emergency_contacts for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create table public.ride_share_links (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references public.rides(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete cascade,
  token uuid not null unique default gen_random_uuid(),
  expires_at timestamptz not null default (now() + interval '8 hours'),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index ride_share_links_ride_idx on public.ride_share_links(ride_id, created_at desc);
alter table public.ride_share_links enable row level security;
revoke all on public.ride_share_links from anon, authenticated;
grant select, insert, update on public.ride_share_links to movara_workflow_owner;
grant select, insert, update on public.rides to movara_workflow_owner;
create policy workflow_ride_share_links on public.ride_share_links for all to movara_workflow_owner using (true) with check (true);

create table public.ride_safety_events (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references public.rides(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  event_type text not null check (event_type in ('sos', 'incident')),
  message text not null default '' check (length(message) <= 2000),
  internal_note text check (internal_note is null or length(internal_note) <= 4000),
  status text not null default 'open' check (status in ('open', 'acknowledged', 'resolved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ride_safety_events_open_idx on public.ride_safety_events(status, created_at desc);
alter table public.ride_safety_events enable row level security;
revoke all on public.ride_safety_events from anon, authenticated;
grant select, insert, update on public.ride_safety_events to movara_workflow_owner;
grant select, insert on public.rides to movara_workflow_owner;
create policy workflow_ride_safety_events on public.ride_safety_events for all to movara_workflow_owner using (true) with check (true);

create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  ride_id uuid references public.rides(id) on delete set null,
  category text not null check (category in ('ride_issue', 'payment', 'lost_item', 'account', 'property', 'other')),
  message text not null check (length(btrim(message)) between 5 and 4000),
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'closed')),
  resolution text check (resolution is null or length(resolution) <= 4000),
  assigned_to uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index support_tickets_reporter_idx on public.support_tickets(reporter_id, created_at desc);
create index support_tickets_queue_idx on public.support_tickets(status, created_at) where status in ('open', 'in_progress');
alter table public.support_tickets enable row level security;
revoke all on public.support_tickets from anon, authenticated;
grant select, insert, update on public.support_tickets to movara_workflow_owner;
grant select on public.rides to movara_workflow_owner;
create policy workflow_support_tickets on public.support_tickets for all to movara_workflow_owner using (true) with check (true);

create table public.support_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (length(btrim(body)) between 1 and 4000),
  internal boolean not null default false,
  created_at timestamptz not null default now()
);
create index support_messages_ticket_idx on public.support_messages(ticket_id,created_at);
alter table public.support_messages enable row level security;
revoke all on public.support_messages from anon,authenticated;
grant select,insert on public.support_messages to movara_workflow_owner;
create policy workflow_support_messages on public.support_messages for all to movara_workflow_owner using (true) with check (true);

create table public.support_categories (
  code text primary key check (code in ('ride_issue','payment','lost_item','account','property','other')),
  label text not null,
  active boolean not null default true,
  sort_order smallint not null default 0
);
alter table public.support_categories enable row level security;
grant select on public.support_categories to anon,authenticated;
insert into public.support_categories(code,label,sort_order) values
 ('ride_issue','Ride issue',1),('payment','Payment',2),('lost_item','Lost item',3),
 ('account','Account',4),('property','Property',5),('other','Other',6);
create policy support_categories_active_read on public.support_categories for select to anon,authenticated using(active);

create table public.ride_feedback (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references public.rides(id) on delete cascade,
  reviewer_id uuid not null references public.profiles(id) on delete cascade,
  reviewee_id uuid not null references public.profiles(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  comment text not null default '' check (length(comment) <= 1000),
  created_at timestamptz not null default now(),
  unique (ride_id, reviewer_id),
  check (reviewer_id <> reviewee_id)
);
create index ride_feedback_reviewee_idx on public.ride_feedback(reviewee_id, created_at desc);
alter table public.ride_feedback enable row level security;
revoke all on public.ride_feedback from anon, authenticated;
grant select, insert on public.ride_feedback to movara_workflow_owner;
grant select on public.rides to movara_workflow_owner;
grant select on public.user_roles to movara_workflow_owner;
create policy workflow_ride_feedback on public.ride_feedback for all to movara_workflow_owner using (true) with check (true);

set role movara_workflow_owner;
create function public.create_ride_share(p_ride_id uuid)
returns table(share_id uuid, share_token uuid, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := (select private.current_user_id()); v_ride public.rides%rowtype;
begin
  if v_user is null then raise exception 'Sign in required'; end if;
  select * into v_ride from public.rides where id = p_ride_id for share;
  if not found or (v_ride.customer_id <> v_user and v_ride.driver_id <> v_user) then raise exception 'Ride not found'; end if;
  if v_ride.status not in ('accepted','in_progress') then raise exception 'Trip sharing is available while a driver is assigned'; end if;
  update public.ride_share_links set revoked_at = pg_catalog.now()
   where ride_id = p_ride_id and created_by = v_user and revoked_at is null;
  return query insert into public.ride_share_links(ride_id, created_by)
   values (p_ride_id, v_user) returning id, token, ride_share_links.expires_at;
end; $$;

create function public.revoke_ride_share(p_share_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.ride_share_links set revoked_at = pg_catalog.now()
   where id = p_share_id and created_by = (select private.current_user_id()) and revoked_at is null;
  if not found then raise exception 'Share link not found'; end if;
end; $$;

create function public.report_ride_safety_event(p_ride_id uuid, p_event_type text, p_message text default '')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid := (select private.current_user_id()); v_id uuid;
begin
  if v_user is null then raise exception 'Sign in required'; end if;
  if p_event_type not in ('sos','incident') or length(coalesce(p_message,'')) > 2000 then raise exception 'Invalid safety report'; end if;
  if not exists (select 1 from public.rides r where r.id=p_ride_id and (r.customer_id=v_user or r.driver_id=v_user)
    and (r.status in ('accepted','in_progress') or r.updated_at > pg_catalog.now() - interval '24 hours')) then raise exception 'Ride not found or no longer reportable'; end if;
  insert into public.ride_safety_events(ride_id,reporter_id,event_type,message) values(p_ride_id,v_user,p_event_type,btrim(coalesce(p_message,''))) returning id into v_id;
  return v_id;
end; $$;

create function public.create_support_ticket(p_category text, p_message text, p_ride_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid := (select private.current_user_id()); v_id uuid;
begin
  if v_user is null then raise exception 'Sign in required'; end if;
  if p_category not in ('ride_issue','payment','lost_item','account','property','other') or length(btrim(p_message)) not between 5 and 4000 then raise exception 'Check the support category and message'; end if;
  if p_ride_id is not null and not exists(select 1 from public.rides r where r.id=p_ride_id and (r.customer_id=v_user or r.driver_id=v_user)) then raise exception 'Ride not found'; end if;
  insert into public.support_tickets(reporter_id,ride_id,category,message) values(v_user,p_ride_id,p_category,btrim(p_message)) returning id into v_id;
  return v_id;
end; $$;

create function public.submit_ride_feedback(p_ride_id uuid, p_rating smallint, p_comment text default '')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid := (select private.current_user_id()); v_ride public.rides%rowtype; v_reviewee uuid; v_id uuid;
begin
  if v_user is null then raise exception 'Sign in required'; end if;
  if p_rating not between 1 and 5 or length(coalesce(p_comment,'')) > 1000 then raise exception 'Invalid rating'; end if;
  select * into v_ride from public.rides where id=p_ride_id and status='completed';
  if not found then raise exception 'Only completed rides can be rated'; end if;
  if v_ride.customer_id=v_user then v_reviewee:=v_ride.driver_id;
  elsif v_ride.driver_id=v_user then v_reviewee:=v_ride.customer_id;
  else raise exception 'Ride not found'; end if;
  if v_reviewee is null then raise exception 'This ride has no other participant to rate'; end if;
  insert into public.ride_feedback(ride_id,reviewer_id,reviewee_id,rating,comment) values(p_ride_id,v_user,v_reviewee,p_rating,btrim(coalesce(p_comment,''))) returning id into v_id;
  return v_id;
exception when unique_violation then raise exception 'You have already rated this ride';
end; $$;

create function public.admin_update_support_ticket(p_ticket_id uuid, p_status text, p_resolution text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_role('administrator') then raise exception 'Administrator access required'; end if;
  if p_status not in ('open','in_progress','resolved','closed') or length(coalesce(p_resolution,'')) > 4000 then raise exception 'Invalid ticket update'; end if;
  perform 1 from public.support_tickets where id=p_ticket_id for update;
  if not found then raise exception 'Ticket not found'; end if;
  if not (
    (status='open' and p_status in ('in_progress','resolved')) or
    (status='in_progress' and p_status in ('open','resolved')) or
    (status='resolved' and p_status in ('closed','in_progress')) or
    (status='closed' and p_status='closed')
  ) then raise exception 'That support ticket status change is not allowed'; end if;
  update public.support_tickets set status=p_status,resolution=nullif(btrim(p_resolution),''),assigned_to=(select private.current_user_id()),updated_at=pg_catalog.now() where id=p_ticket_id;
end; $$;

create function public.admin_assign_support_ticket(p_ticket_id uuid,p_assignee uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_role('administrator') then raise exception 'Administrator access required'; end if;
  if p_assignee is not null and not exists(select 1 from public.user_roles ur where ur.user_id=p_assignee and ur.role='administrator') then raise exception 'Assignee must be an administrator'; end if;
  update public.support_tickets set assigned_to=p_assignee,updated_at=pg_catalog.now() where id=p_ticket_id;
  if not found then raise exception 'Ticket not found'; end if;
end; $$;

create function public.admin_add_support_message(p_ticket_id uuid,p_body text,p_internal boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not private.has_role('administrator') then raise exception 'Administrator access required'; end if;
  if length(btrim(p_body)) not between 1 and 4000 then raise exception 'Message cannot be empty'; end if;
  if not exists(select 1 from public.support_tickets where id=p_ticket_id) then raise exception 'Ticket not found'; end if;
  insert into public.support_messages(ticket_id,author_id,body,internal) values(p_ticket_id,(select private.current_user_id()),btrim(p_body),p_internal) returning id into v_id;
  return v_id;
end; $$;

create function public.add_support_reply(p_ticket_id uuid,p_body text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if (select private.current_user_id()) is null then raise exception 'Sign in required'; end if;
  if length(btrim(p_body)) not between 1 and 4000 then raise exception 'Message cannot be empty'; end if;
  if not exists(select 1 from public.support_tickets where id=p_ticket_id and reporter_id=(select private.current_user_id()) and status not in ('closed')) then raise exception 'Ticket not found or closed'; end if;
  insert into public.support_messages(ticket_id,author_id,body,internal) values(p_ticket_id,(select private.current_user_id()),btrim(p_body),false) returning id into v_id;
  return v_id;
end; $$;

create function public.my_support_messages(p_ticket_id uuid)
returns table(id uuid,author_id uuid,body text,created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select m.id,m.author_id,m.body,m.created_at from public.support_messages m
  join public.support_tickets t on t.id=m.ticket_id
  where t.id=p_ticket_id and t.reporter_id=(select private.current_user_id()) and not m.internal
  order by m.created_at limit 200;
$$;

create function public.my_support_tickets()
returns table(id uuid,category text,message text,status text,resolution text,created_at timestamptz,ride_id uuid)
language sql stable security definer set search_path = '' as $$
  select t.id,t.category,t.message,t.status,t.resolution,t.created_at,t.ride_id
  from public.support_tickets t where t.reporter_id=(select private.current_user_id()) order by t.created_at desc limit 50;
$$;

create function public.admin_list_support_tickets()
returns table(id uuid,reporter_id uuid,ride_id uuid,category text,message text,status text,resolution text,created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.has_role('administrator') then raise exception 'Administrator access required'; end if;
  return query select t.id,t.reporter_id,t.ride_id,t.category,t.message,t.status,t.resolution,t.created_at
    from public.support_tickets t order by t.created_at asc limit 200;
end; $$;

create function public.admin_list_safety_events()
returns table(id uuid,ride_id uuid,reporter_id uuid,event_type text,message text,status text,created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.has_role('administrator') then raise exception 'Administrator access required'; end if;
  return query select e.id,e.ride_id,e.reporter_id,e.event_type,e.message,e.status,e.created_at
    from public.ride_safety_events e order by e.created_at asc limit 200;
end; $$;

create function public.admin_update_safety_event(p_event_id uuid,p_status text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_role('administrator') then raise exception 'Administrator access required'; end if;
  if p_status not in ('acknowledged','resolved') then raise exception 'Invalid safety report status'; end if;
  update public.ride_safety_events set status=p_status,updated_at=pg_catalog.now() where id=p_event_id;
  if not found then raise exception 'Safety report not found'; end if;
end; $$;

create function public.admin_add_safety_note(p_event_id uuid,p_note text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not private.has_role('administrator') then raise exception 'Administrator access required'; end if;
  if length(btrim(p_note)) not between 1 and 4000 then raise exception 'Note cannot be empty'; end if;
  update public.ride_safety_events set internal_note=btrim(p_note),updated_at=pg_catalog.now() where id=p_event_id returning id into v_id;
  if v_id is null then raise exception 'Safety report not found'; end if;
  return v_id;
end; $$;

create function public.admin_add_safety_event_note(p_event_id uuid,p_note text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_role('administrator') then raise exception 'Administrator access required'; end if;
  if length(btrim(p_note)) not between 1 and 4000 then raise exception 'Note cannot be empty'; end if;
  update public.ride_safety_events set internal_note=btrim(p_note),updated_at=pg_catalog.now() where id=p_event_id;
  if not found then raise exception 'Safety report not found'; end if;
end; $$;

create function public.admin_list_support_messages(p_ticket_id uuid)
returns table(id uuid,author_id uuid,body text,internal boolean,created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.has_role('administrator') then raise exception 'Administrator access required'; end if;
  if not exists(select 1 from public.support_tickets where id=p_ticket_id) then raise exception 'Ticket not found'; end if;
  return query select m.id,m.author_id,m.body,m.internal,m.created_at from public.support_messages m
    where m.ticket_id=p_ticket_id order by m.created_at limit 200;
end; $$;

alter function public.create_ride_share(uuid) owner to movara_workflow_owner;
alter function public.revoke_ride_share(uuid) owner to movara_workflow_owner;
alter function public.report_ride_safety_event(uuid,text,text) owner to movara_workflow_owner;
alter function public.create_support_ticket(text,text,uuid) owner to movara_workflow_owner;
alter function public.submit_ride_feedback(uuid,smallint,text) owner to movara_workflow_owner;
alter function public.admin_update_support_ticket(uuid,text,text) owner to movara_workflow_owner;
alter function public.my_support_tickets() owner to movara_workflow_owner;
alter function public.admin_list_support_tickets() owner to movara_workflow_owner;
alter function public.admin_list_safety_events() owner to movara_workflow_owner;
alter function public.admin_update_safety_event(uuid,text) owner to movara_workflow_owner;
alter function public.admin_assign_support_ticket(uuid,uuid) owner to movara_workflow_owner;
alter function public.admin_add_support_message(uuid,text,boolean) owner to movara_workflow_owner;
alter function public.add_support_reply(uuid,text) owner to movara_workflow_owner;
alter function public.my_support_messages(uuid) owner to movara_workflow_owner;
alter function public.admin_add_safety_note(uuid,text) owner to movara_workflow_owner;
alter function public.admin_add_safety_event_note(uuid,text) owner to movara_workflow_owner;
alter function public.admin_list_support_messages(uuid) owner to movara_workflow_owner;
reset role;

grant execute on function public.create_ride_share(uuid) to authenticated;
grant execute on function public.revoke_ride_share(uuid) to authenticated;
grant execute on function public.report_ride_safety_event(uuid,text,text) to authenticated;
grant execute on function public.create_support_ticket(text,text,uuid) to authenticated;
grant execute on function public.submit_ride_feedback(uuid,smallint,text) to authenticated;
grant execute on function public.admin_update_support_ticket(uuid,text,text) to authenticated;
grant execute on function public.my_support_tickets() to authenticated;
grant execute on function public.admin_list_support_tickets() to authenticated;
grant execute on function public.admin_list_safety_events() to authenticated;
grant execute on function public.admin_update_safety_event(uuid,text) to authenticated;
grant execute on function public.admin_assign_support_ticket(uuid,uuid) to authenticated;
grant execute on function public.admin_add_support_message(uuid,text,boolean) to authenticated;
grant execute on function public.add_support_reply(uuid,text) to authenticated;
grant execute on function public.my_support_messages(uuid) to authenticated;
grant execute on function public.admin_add_safety_note(uuid,text) to authenticated;
grant execute on function public.admin_add_safety_event_note(uuid,text) to authenticated;
grant execute on function public.admin_list_support_messages(uuid) to authenticated;
revoke movara_workflow_owner from postgres;
revoke create on schema public from movara_workflow_owner;

revoke all on public.ride_safety_events,public.support_tickets,public.support_messages from authenticated,anon;

do $$ begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='ride_safety_events') then
    alter publication supabase_realtime add table public.ride_safety_events;
  end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='support_tickets') then
    alter publication supabase_realtime add table public.support_tickets;
  end if;
end $$;
