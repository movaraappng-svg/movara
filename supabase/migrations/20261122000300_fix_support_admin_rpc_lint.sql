-- Fix support administration RPCs that reference unbound PL/pgSQL names.
set role pg_database_owner;
grant create on schema public to movara_workflow_owner;
reset role;

set role movara_workflow_owner;

create or replace function public.admin_update_support_ticket(
  p_ticket_id uuid,
  p_status text,
  p_resolution text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current_status text;
begin
  if not private.has_role('administrator') then
    raise exception 'Administrator access required';
  end if;
  if p_status not in ('open','in_progress','resolved','closed')
    or length(coalesce(p_resolution,'')) > 4000 then
    raise exception 'Invalid ticket update';
  end if;

  select ticket.status into v_current_status
  from public.support_tickets as ticket
  where ticket.id = p_ticket_id
  for update;
  if not found then raise exception 'Ticket not found'; end if;

  if not (
    (v_current_status = 'open' and p_status in ('in_progress','resolved')) or
    (v_current_status = 'in_progress' and p_status in ('open','resolved')) or
    (v_current_status = 'resolved' and p_status in ('closed','in_progress')) or
    (v_current_status = 'closed' and p_status = 'closed')
  ) then
    raise exception 'That support ticket status change is not allowed';
  end if;

  update public.support_tickets as ticket
  set status = p_status,
      resolution = nullif(btrim(p_resolution),''),
      assigned_to = (select private.current_user_id()),
      updated_at = pg_catalog.now()
  where ticket.id = p_ticket_id;
end;
$$;

create or replace function public.admin_list_support_messages(p_ticket_id uuid)
returns table(id uuid, author_id uuid, body text, internal boolean, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_role('administrator') then
    raise exception 'Administrator access required';
  end if;
  if not exists (
    select 1 from public.support_tickets as ticket where ticket.id = p_ticket_id
  ) then
    raise exception 'Ticket not found';
  end if;
  return query
    select message.id, message.author_id, message.body, message.internal, message.created_at
    from public.support_messages as message
    where message.ticket_id = p_ticket_id
    order by message.created_at
    limit 200;
end;
$$;

reset role;
set role pg_database_owner;
revoke create on schema public from movara_workflow_owner;
reset role;
