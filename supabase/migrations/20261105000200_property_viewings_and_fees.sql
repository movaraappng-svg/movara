-- Viewing-confirmation connection fee domain.

create type public.property_viewing_status as enum
  ('proposed', 'arranged', 'cancelled', 'disputed', 'closed');
create type public.viewing_reschedule_status as enum
  ('pending', 'accepted', 'rejected', 'withdrawn');
create type public.tenancy_search_cycle_status as enum ('open', 'closed');
create type public.connection_outcome_status as enum
  ('fee_eligible', 'disputed', 'waived', 'closed');
create type public.landlord_connection_fee_status as enum (
  'awaiting_configuration', 'pending', 'paid', 'overdue',
  'disputed', 'waived', 'failed', 'cancelled'
);

alter table public.enquiries
  add column idempotency_key uuid;
create unique index enquiries_customer_idempotency_uq
  on public.enquiries(customer_id, idempotency_key)
  where idempotency_key is not null;

create table public.tenancy_search_cycles (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null,
  landlord_id uuid not null references public.profiles(id),
  tenant_id uuid not null references public.profiles(id),
  cycle_number integer not null check (cycle_number > 0),
  status public.tenancy_search_cycle_status not null default 'open',
  created_by uuid not null references public.profiles(id),
  authorized_by uuid references public.profiles(id),
  authorization_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  foreign key (property_id, landlord_id)
    references public.properties(id, landlord_id),
  check (tenant_id <> landlord_id),
  check (
    (cycle_number = 1 and authorized_by is null)
    or (cycle_number > 1 and authorized_by is not null
      and length(trim(coalesce(authorization_reason, ''))) > 0)
  ),
  check (
    (status = 'open' and closed_at is null)
    or (status = 'closed' and closed_at is not null)
  ),
  unique (property_id, landlord_id, tenant_id, cycle_number),
  unique (id, property_id, landlord_id, tenant_id)
);

create unique index tenancy_cycles_one_open
  on public.tenancy_search_cycles(property_id, landlord_id, tenant_id)
  where status = 'open';

create table public.property_viewings (
  id uuid primary key default gen_random_uuid(),
  enquiry_id uuid not null,
  property_id uuid not null,
  landlord_id uuid not null,
  tenant_id uuid not null,
  tenancy_cycle_id uuid not null,
  requested_by uuid not null references public.profiles(id),
  idempotency_key uuid not null,
  proposed_at timestamptz not null,
  status public.property_viewing_status not null default 'proposed',
  landlord_confirmed_at timestamptz,
  tenant_confirmed_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles(id),
  cancellation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (enquiry_id, property_id, tenant_id, landlord_id)
    references public.enquiries(id, property_id, customer_id, landlord_id),
  foreign key (tenancy_cycle_id, property_id, landlord_id, tenant_id)
    references public.tenancy_search_cycles
      (id, property_id, landlord_id, tenant_id),
  check (requested_by in (tenant_id, landlord_id)),
  check (tenant_id <> landlord_id),
  check (
    (cancelled_at is null and cancelled_by is null
      and cancellation_reason is null)
    or (cancelled_at is not null and cancelled_by is not null
      and length(trim(coalesce(cancellation_reason, ''))) > 0)
  ),
  check (
    status <> 'arranged'
    or (landlord_confirmed_at is not null and tenant_confirmed_at is not null)
  ),
  check (status <> 'cancelled' or cancelled_at is not null),
  unique (id, property_id, landlord_id, tenant_id),
  unique (requested_by, idempotency_key)
);

create unique index property_viewings_one_active_per_enquiry
  on public.property_viewings(enquiry_id)
  where status in ('proposed', 'arranged', 'disputed');
create index property_viewings_tenant_idx
  on public.property_viewings(tenant_id, proposed_at desc);
create index property_viewings_landlord_idx
  on public.property_viewings(landlord_id, status, proposed_at desc);
create index property_viewings_cycle_idx
  on public.property_viewings(tenancy_cycle_id, created_at desc);

create table public.property_viewing_reschedules (
  id uuid primary key default gen_random_uuid(),
  viewing_id uuid not null references public.property_viewings(id),
  requested_by uuid not null references public.profiles(id),
  proposed_at timestamptz not null,
  status public.viewing_reschedule_status not null default 'pending',
  responded_by uuid references public.profiles(id),
  responded_at timestamptz,
  response_note text,
  created_at timestamptz not null default now(),
  check (
    (status = 'pending' and responded_at is null and responded_by is null)
    or (status <> 'pending' and responded_at is not null and responded_by is not null)
  ),
  check (responded_by is null or responded_by <> requested_by)
);
create unique index property_viewings_one_pending_reschedule
  on public.property_viewing_reschedules(viewing_id)
  where status = 'pending';
create index property_viewing_reschedules_viewing_idx
  on public.property_viewing_reschedules(viewing_id, created_at desc);

create table public.property_viewing_events (
  id uuid primary key default gen_random_uuid(),
  viewing_id uuid not null references public.property_viewings(id),
  actor_id uuid references public.profiles(id),
  event_type text not null check (event_type in (
    'created', 'tenant_confirmed', 'landlord_confirmed', 'arranged',
    'cancelled_before_confirmation', 'cancelled_after_confirmation',
    'reschedule_requested', 'reschedule_accepted', 'reschedule_rejected',
    'dispute_opened', 'dispute_resolved', 'viewing_closed',
    'connection_outcome_created', 'existing_cycle_outcome_reused',
    'fee_created', 'fee_configuration_assigned', 'fee_waived',
    'fee_payment_failed', 'fee_paid'
  )),
  event_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index property_viewing_events_viewing_idx
  on public.property_viewing_events(viewing_id, created_at);

create table public.landlord_connection_fee_settings (
  id uuid primary key default gen_random_uuid(),
  amount_kobo bigint not null check (amount_kobo > 0),
  currency char(3) not null default 'NGN' check (currency = 'NGN'),
  due_interval_hours integer not null check (due_interval_hours > 0),
  effective_from timestamptz not null,
  effective_until timestamptz,
  effective_period tstzrange generated always as
    (tstzrange(effective_from, effective_until, '[)')) stored,
  enabled boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check (effective_until is null or effective_until > effective_from),
  exclude using gist (effective_period with &&) where (enabled),
  unique (id, amount_kobo, due_interval_hours, currency)
);

create table public.connection_outcomes (
  id uuid primary key default gen_random_uuid(),
  tenancy_cycle_id uuid not null unique,
  viewing_id uuid not null unique,
  enquiry_id uuid not null,
  property_id uuid not null,
  landlord_id uuid not null,
  tenant_id uuid not null,
  status public.connection_outcome_status not null default 'fee_eligible',
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenancy_cycle_id, property_id, landlord_id, tenant_id)
    references public.tenancy_search_cycles
      (id, property_id, landlord_id, tenant_id),
  foreign key (viewing_id, property_id, landlord_id, tenant_id)
    references public.property_viewings
      (id, property_id, landlord_id, tenant_id),
  foreign key (enquiry_id, property_id, tenant_id, landlord_id)
    references public.enquiries(id, property_id, customer_id, landlord_id),
  unique (id, landlord_id),
  unique (id, viewing_id)
);
create index connection_outcomes_landlord_idx
  on public.connection_outcomes(landlord_id, created_at desc);
create index connection_outcomes_tenant_idx
  on public.connection_outcomes(tenant_id, created_at desc);

create table public.landlord_connection_fees (
  id uuid primary key default gen_random_uuid(),
  connection_outcome_id uuid not null unique,
  viewing_id uuid not null unique,
  landlord_id uuid not null references public.profiles(id),
  fee_setting_id uuid references public.landlord_connection_fee_settings(id),
  amount_kobo bigint,
  due_interval_hours integer,
  currency char(3) not null default 'NGN' check (currency = 'NGN'),
  status public.landlord_connection_fee_status not null
    default 'awaiting_configuration',
  due_at timestamptz,
  payment_reference text,
  paid_at timestamptz,
  waived_at timestamptz,
  waived_by uuid references public.profiles(id),
  waiver_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (connection_outcome_id, landlord_id)
    references public.connection_outcomes(id, landlord_id),
  foreign key (connection_outcome_id, viewing_id)
    references public.connection_outcomes(id, viewing_id),
  foreign key (fee_setting_id, amount_kobo, due_interval_hours, currency)
    references public.landlord_connection_fee_settings
      (id, amount_kobo, due_interval_hours, currency),
  unique (id, viewing_id),
  check (amount_kobo is null or amount_kobo > 0),
  check (due_interval_hours is null or due_interval_hours > 0),
  check (
    (status = 'awaiting_configuration' and amount_kobo is null
      and fee_setting_id is null and due_interval_hours is null and due_at is null)
    or
    (status <> 'awaiting_configuration' and amount_kobo is not null
      and fee_setting_id is not null and due_interval_hours is not null
      and due_at is not null)
  ),
  check (
    status <> 'paid' or (paid_at is not null and payment_reference is not null)
  ),
  check (
    status <> 'waived'
    or (waived_at is not null and waived_by is not null
      and length(trim(coalesce(waiver_reason, ''))) > 0)
  )
);
create index landlord_connection_fees_landlord_status_due_idx
  on public.landlord_connection_fees(landlord_id, status, due_at);
create unique index landlord_connection_fee_payment_reference_uq
  on public.landlord_connection_fees(payment_reference)
  where payment_reference is not null;

alter table public.payments
  add column landlord_fee_id uuid
    references public.landlord_connection_fees(id);
create index payments_fee_idx on public.payments(landlord_fee_id);

alter table public.disputes
  add column property_viewing_id uuid references public.property_viewings(id),
  add column landlord_fee_id uuid references public.landlord_connection_fees(id);
alter table public.disputes
  add constraint disputes_subject_required check (
    num_nonnulls(ride_id, property_viewing_id, landlord_fee_id) > 0
  ),
  add constraint disputes_ride_exclusive check (
    ride_id is null or (property_viewing_id is null and landlord_fee_id is null)
  ),
  add constraint disputes_fee_has_viewing check (
    landlord_fee_id is null or property_viewing_id is not null
  ),
  add constraint disputes_fee_viewing_match foreign key
    (landlord_fee_id, property_viewing_id)
    references public.landlord_connection_fees(id, viewing_id);
create unique index disputes_one_active_fee_dispute
  on public.disputes(landlord_fee_id)
  where landlord_fee_id is not null and status in ('opened', 'reviewing');
create index disputes_viewing_idx on public.disputes(property_viewing_id);

drop policy disputes_read_parties_admin on public.disputes;
create policy disputes_read_parties_admin on public.disputes
  for select to authenticated using (
    opened_by = (select auth.uid())
    or (select private.has_role('administrator'))
    or exists (
      select 1 from public.property_viewings v
      where v.id = property_viewing_id
        and (v.tenant_id = (select auth.uid())
          or v.landlord_id = (select auth.uid()))
    )
    or exists (
      select 1 from public.rides r where r.id = ride_id
        and (r.customer_id = (select auth.uid())
          or r.driver_id = (select auth.uid()))
    )
  );

create trigger tenancy_cycles_updated_at before update
  on public.tenancy_search_cycles for each row
  execute function private.set_updated_at();
create trigger property_viewings_updated_at before update
  on public.property_viewings for each row
  execute function private.set_updated_at();
create trigger connection_outcomes_updated_at before update
  on public.connection_outcomes for each row
  execute function private.set_updated_at();
create trigger landlord_connection_fees_updated_at before update
  on public.landlord_connection_fees for each row
  execute function private.set_updated_at();

alter table public.tenancy_search_cycles enable row level security;
alter table public.property_viewings enable row level security;
alter table public.property_viewing_reschedules enable row level security;
alter table public.property_viewing_events enable row level security;
alter table public.landlord_connection_fee_settings enable row level security;
alter table public.connection_outcomes enable row level security;
alter table public.landlord_connection_fees enable row level security;

revoke all on public.tenancy_search_cycles, public.property_viewings,
  public.property_viewing_reschedules, public.property_viewing_events,
  public.landlord_connection_fee_settings, public.connection_outcomes,
  public.landlord_connection_fees from anon, authenticated;
grant select on public.tenancy_search_cycles, public.property_viewings,
  public.property_viewing_reschedules, public.property_viewing_events,
  public.connection_outcomes, public.landlord_connection_fees,
  public.landlord_connection_fee_settings to authenticated;

create policy tenancy_cycle_select_parties on public.tenancy_search_cycles
  for select to authenticated using (
    tenant_id = (select auth.uid()) or landlord_id = (select auth.uid())
    or (select private.has_role('administrator'))
  );
create policy viewing_select_parties on public.property_viewings
  for select to authenticated using (
    tenant_id = (select auth.uid()) or landlord_id = (select auth.uid())
    or (select private.has_role('administrator'))
  );
create policy reschedule_select_parties on public.property_viewing_reschedules
  for select to authenticated using (
    exists (select 1 from public.property_viewings v
      where v.id = viewing_id and (
        v.tenant_id = (select auth.uid())
        or v.landlord_id = (select auth.uid())
        or (select private.has_role('administrator'))
      ))
  );
create policy viewing_events_select_parties on public.property_viewing_events
  for select to authenticated using (
    exists (select 1 from public.property_viewings v
      where v.id = viewing_id and (
        v.tenant_id = (select auth.uid())
        or v.landlord_id = (select auth.uid())
        or (select private.has_role('administrator'))
      ))
  );
create policy outcome_select_parties on public.connection_outcomes
  for select to authenticated using (
    tenant_id = (select auth.uid()) or landlord_id = (select auth.uid())
    or (select private.has_role('administrator'))
  );
create policy fee_select_landlord_admin on public.landlord_connection_fees
  for select to authenticated using (
    landlord_id = (select auth.uid())
    or (select private.has_role('administrator'))
  );
create policy fee_settings_admin_read on public.landlord_connection_fee_settings
  for select to authenticated using (
    (select private.has_role('administrator'))
  );

-- Fee settings are never readable through client roles. No client write policies
-- are defined for cycles, viewings, outcomes, fees, events, or payment records.
