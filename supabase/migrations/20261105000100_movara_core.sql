-- MoVara Stage 4A base schema. Requires a Supabase-managed local project.
-- No demo properties, credentials, admin users, or verification decisions are seeded.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to anon, authenticated, service_role;

create type public.app_role as enum
  ('customer', 'driver', 'landlord', 'administrator');
create type public.listing_status as enum
  ('draft', 'pending_review', 'published', 'paused', 'rented', 'rejected');
create type public.property_category as enum (
  'self_contained', 'one_bedroom', 'two_bedroom', 'three_bedroom',
  'duplex', 'commercial', 'land'
);
create type public.rent_sale_type as enum ('rent', 'sale');
create type public.verification_status as enum
  ('not_submitted', 'pending', 'approved', 'rejected', 'suspended');
create type public.ride_status as enum
  ('requested', 'matching', 'accepted', 'in_progress', 'completed', 'cancelled');
create type public.ride_request_status as enum
  ('offered', 'accepted', 'rejected', 'expired', 'withdrawn');
create type public.payment_status as enum
  ('pending', 'succeeded', 'failed', 'refunded');
create type public.dispute_status as enum
  ('opened', 'reviewing', 'resolved', 'rejected');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '' check (length(display_name) <= 120),
  phone text check (phone is null or length(phone) <= 32),
  avatar_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_roles (
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.app_role not null,
  granted_at timestamptz not null default now(),
  granted_by uuid references public.profiles(id),
  primary key (user_id, role)
);

create table public.role_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  requested_role public.app_role not null
    check (requested_role in ('driver', 'landlord')),
  status public.verification_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, requested_role)
);

create table public.nigerian_states (
  code text primary key check (code ~ '^NG-[A-Z]{2}$'),
  name text not null unique
);

create table public.nigerian_lgas (
  id uuid primary key default gen_random_uuid(),
  state_code text not null references public.nigerian_states(code),
  name text not null,
  unique (state_code, name),
  unique (id, state_code)
);

create table public.neighbourhoods (
  id uuid primary key default gen_random_uuid(),
  lga_id uuid not null references public.nigerian_lgas(id),
  name text not null,
  unique (lga_id, name),
  unique (id, lga_id)
);

create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.profiles(id),
  vehicle_type text not null check (vehicle_type in ('car', 'keke')),
  make text not null,
  model text not null,
  registration_number text not null,
  capacity integer not null check (capacity between 1 and 20),
  verification public.verification_status not null default 'pending',
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (registration_number),
  unique (id, driver_id)
);

create table public.driver_documents (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.profiles(id),
  document_type text not null check (length(trim(document_type)) > 0),
  object_path text not null unique,
  verification public.verification_status not null default 'pending',
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id)
);

create table public.landlord_documents (
  id uuid primary key default gen_random_uuid(),
  landlord_id uuid not null references public.profiles(id),
  document_type text not null check (length(trim(document_type)) between 1 and 100),
  object_path text not null unique,
  verification public.verification_status not null default 'pending',
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id)
);

create table public.driver_verifications (
  driver_id uuid primary key references public.profiles(id),
  status public.verification_status not null default 'not_submitted',
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

create table public.landlord_verifications (
  landlord_id uuid primary key references public.profiles(id),
  status public.verification_status not null default 'not_submitted',
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

create table public.properties (
  id uuid primary key default gen_random_uuid(),
  landlord_id uuid not null references public.profiles(id),
  title text not null check (length(trim(title)) between 3 and 160),
  description text not null default '' check (length(description) <= 10000),
  category public.property_category not null,
  transaction_type public.rent_sale_type not null,
  price_ngn_kobo bigint not null check (price_ngn_kobo > 0),
  currency char(3) not null default 'NGN' check (currency = 'NGN'),
  state_code text not null references public.nigerian_states(code),
  lga_id uuid not null,
  neighbourhood_id uuid references public.neighbourhoods(id),
  address text not null check (length(trim(address)) > 0),
  status public.listing_status not null default 'draft',
  verification public.verification_status not null default 'not_submitted',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (lga_id, state_code)
    references public.nigerian_lgas(id, state_code),
  foreign key (neighbourhood_id, lga_id)
    references public.neighbourhoods(id, lga_id),
  unique (id, landlord_id),
  unique (id, landlord_id, state_code, lga_id)
);

create index properties_search_idx on public.properties
  (state_code, lga_id, transaction_type, category, price_ngn_kobo)
  where status = 'published';
create index properties_landlord_idx
  on public.properties(landlord_id, status, created_at desc);

create table public.property_images (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null,
  landlord_id uuid not null,
  object_path text not null unique,
  sort_order smallint not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  foreign key (property_id, landlord_id)
    references public.properties(id, landlord_id) on delete cascade
);

create table public.property_verifications (
  property_id uuid primary key references public.properties(id),
  status public.verification_status not null default 'not_submitted',
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

create table public.enquiries (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null,
  landlord_id uuid not null,
  customer_id uuid not null references public.profiles(id),
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (property_id, landlord_id)
    references public.properties(id, landlord_id),
  check (customer_id <> landlord_id),
  unique (id, property_id, customer_id, landlord_id)
);

create table public.enquiry_messages (
  id uuid primary key default gen_random_uuid(),
  enquiry_id uuid not null references public.enquiries(id) on delete cascade,
  sender_id uuid not null references public.profiles(id),
  body text not null check (length(trim(body)) between 1 and 5000),
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  unique (enquiry_id, sender_id, idempotency_key)
);

create index enquiries_landlord_recent_idx
  on public.enquiries(landlord_id, updated_at desc);
create index enquiries_customer_recent_idx
  on public.enquiries(customer_id, updated_at desc);
create index enquiry_messages_thread_idx
  on public.enquiry_messages(enquiry_id, created_at);

create table public.rides (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id),
  driver_id uuid references public.profiles(id),
  vehicle_id uuid,
  pickup_label text not null,
  destination_label text not null,
  passenger_count smallint not null check (passenger_count between 1 and 20),
  estimated_fare_ngn_kobo bigint check (estimated_fare_ngn_kobo > 0),
  final_fare_ngn_kobo bigint check (final_fare_ngn_kobo > 0),
  currency char(3) not null default 'NGN' check (currency = 'NGN'),
  status public.ride_status not null default 'requested',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (vehicle_id, driver_id)
    references public.vehicles(id, driver_id),
  check ((vehicle_id is null) = (driver_id is null))
);

create index rides_customer_recent_idx on public.rides(customer_id, created_at desc);
create index rides_driver_recent_idx on public.rides(driver_id, status, created_at desc);

create table public.ride_requests (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references public.rides(id) on delete cascade,
  driver_id uuid not null references public.profiles(id),
  status public.ride_request_status not null default 'offered',
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (ride_id, driver_id)
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  payer_id uuid not null references public.profiles(id),
  amount_kobo bigint not null check (amount_kobo > 0),
  currency char(3) not null default 'NGN' check (currency = 'NGN'),
  status public.payment_status not null default 'pending',
  provider text,
  provider_reference text,
  provider_event_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index payment_provider_event_uq
  on public.payments(provider, provider_event_id)
  where provider_event_id is not null;

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id),
  subject_id uuid not null references public.profiles(id),
  ride_id uuid references public.rides(id),
  property_id uuid references public.properties(id),
  rating smallint not null check (rating between 1 and 5),
  body text not null default '' check (length(body) <= 3000),
  created_at timestamptz not null default now(),
  check (author_id <> subject_id),
  check (num_nonnulls(ride_id, property_id) = 1)
);

create table public.favourites (
  user_id uuid not null references public.profiles(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, property_id)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_recent_idx
  on public.notifications(user_id, created_at desc);

create table public.disputes (
  id uuid primary key default gen_random_uuid(),
  opened_by uuid not null references public.profiles(id),
  ride_id uuid references public.rides(id),
  reason text not null check (length(trim(reason)) between 1 and 5000),
  status public.dispute_status not null default 'opened',
  resolution text,
  resolved_by uuid references public.profiles(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.verification_audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id),
  subject_id uuid not null references public.profiles(id),
  subject_type text not null check
    (subject_type in ('driver', 'landlord', 'property', 'document', 'vehicle')),
  subject_entity_id uuid,
  prior_status public.verification_status,
  new_status public.verification_status not null,
  reason text,
  created_at timestamptz not null default now()
);

-- Seed the national state/FCT catalog and the initial regional LGA set.
insert into public.nigerian_states(code, name) values
 ('NG-AB','Abia'),('NG-AD','Adamawa'),('NG-AK','Akwa Ibom'),
 ('NG-AN','Anambra'),('NG-BA','Bauchi'),('NG-BY','Bayelsa'),
 ('NG-BE','Benue'),('NG-BO','Borno'),('NG-CR','Cross River'),
 ('NG-DE','Delta'),('NG-EB','Ebonyi'),('NG-ED','Edo'),
 ('NG-EK','Ekiti'),('NG-EN','Enugu'),('NG-FC','Federal Capital Territory'),
 ('NG-GO','Gombe'),('NG-IM','Imo'),('NG-JI','Jigawa'),
 ('NG-KD','Kaduna'),('NG-KN','Kano'),('NG-KT','Katsina'),
 ('NG-KE','Kebbi'),('NG-KO','Kogi'),('NG-KW','Kwara'),
 ('NG-LA','Lagos'),('NG-NA','Nasarawa'),('NG-NI','Niger'),
 ('NG-OG','Ogun'),('NG-ON','Ondo'),('NG-OS','Osun'),
 ('NG-OY','Oyo'),('NG-PL','Plateau'),('NG-RI','Rivers'),
 ('NG-SO','Sokoto'),('NG-TA','Taraba'),('NG-YO','Yobe'),
 ('NG-ZA','Zamfara');

insert into public.nigerian_lgas(state_code, name)
select 'NG-EN', lga.name
from (values
 ('Aninri'),('Awgu'),('Enugu East'),('Enugu North'),('Enugu South'),
 ('Ezeagu'),('Igbo-Etiti'),('Igbo-Eze North'),('Igbo-Eze South'),
 ('Isi-Uzo'),('Nkanu East'),('Nkanu West'),('Nsukka'),
 ('Oji River'),('Udenu'),('Udi'),('Uzo-Uwani')
) as lga(name);

create function private.set_updated_at()
returns trigger language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

create function private.has_role(p_role public.app_role)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = (select auth.uid()) and ur.role = p_role
  );
$$;

create function private.create_auth_profile()
returns trigger language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.profiles(id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', '')
  );
  insert into public.user_roles(user_id, role) values (new.id, 'customer');
  return new;
end;
$$;

create trigger auth_user_profile_created
after insert on auth.users
for each row execute function private.create_auth_profile();

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles','role_requests','vehicles','properties','enquiries','rides',
    'payments'
  ] loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function private.set_updated_at()',
      t || '_updated_at', t
    );
  end loop;
end;
$$;

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.role_requests enable row level security;
alter table public.nigerian_states enable row level security;
alter table public.nigerian_lgas enable row level security;
alter table public.neighbourhoods enable row level security;
alter table public.vehicles enable row level security;
alter table public.driver_documents enable row level security;
alter table public.landlord_documents enable row level security;
alter table public.driver_verifications enable row level security;
alter table public.landlord_verifications enable row level security;
alter table public.properties enable row level security;
alter table public.property_images enable row level security;
alter table public.property_verifications enable row level security;
alter table public.enquiries enable row level security;
alter table public.enquiry_messages enable row level security;
alter table public.rides enable row level security;
alter table public.ride_requests enable row level security;
alter table public.payments enable row level security;
alter table public.reviews enable row level security;
alter table public.favourites enable row level security;
alter table public.notifications enable row level security;
alter table public.disputes enable row level security;
alter table public.audit_logs enable row level security;
alter table public.verification_audit_logs enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant usage on schema public to anon, authenticated, service_role;
grant select on public.nigerian_states, public.nigerian_lgas,
  public.neighbourhoods to anon, authenticated;
grant select on public.properties, public.property_images, public.reviews
  to anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name, phone, avatar_path) on public.profiles to authenticated;
grant select on public.user_roles, public.role_requests, public.vehicles,
  public.driver_documents, public.driver_verifications,
  public.landlord_documents,
  public.landlord_verifications, public.property_verifications,
  public.enquiries, public.enquiry_messages, public.rides, public.ride_requests,
  public.payments, public.favourites, public.notifications,
  public.disputes to authenticated;

create policy profile_read_self on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy profile_update_self on public.profiles
  for update to authenticated using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
create policy user_roles_read_self_admin on public.user_roles
  for select to authenticated using (
    user_id = (select auth.uid())
    or (select private.has_role('administrator'))
  );
create policy role_requests_read_self_admin on public.role_requests
  for select to authenticated using (
    user_id = (select auth.uid())
    or (select private.has_role('administrator'))
  );
create policy location_catalog_read on public.nigerian_states
  for select to anon, authenticated using (true);
create policy lga_catalog_read on public.nigerian_lgas
  for select to anon, authenticated using (true);
create policy neighbourhood_catalog_read on public.neighbourhoods
  for select to anon, authenticated using (true);
create policy properties_public_or_owner on public.properties
  for select to anon, authenticated using (
    status = 'published'
    or landlord_id = (select auth.uid())
    or (select private.has_role('administrator'))
  );
create policy property_images_public_or_owner on public.property_images
  for select to anon, authenticated using (
    exists (
      select 1 from public.properties p
      where p.id = property_id
        and (p.status = 'published'
          or p.landlord_id = (select auth.uid())
          or (select private.has_role('administrator')))
    )
  );
create policy vehicles_read_owner_admin on public.vehicles
  for select to authenticated using (
    driver_id = (select auth.uid())
    or (select private.has_role('administrator'))
  );
create policy driver_docs_read_owner_admin on public.driver_documents
  for select to authenticated using (
    driver_id = (select auth.uid())
    or (select private.has_role('administrator'))
  );
create policy landlord_docs_read_owner_admin on public.landlord_documents
  for select to authenticated using (
    landlord_id = (select auth.uid())
    or (select private.has_role('administrator'))
  );
create policy driver_verification_read_self_admin on public.driver_verifications
  for select to authenticated using (
    driver_id = (select auth.uid())
    or (select private.has_role('administrator'))
  );
create policy landlord_verification_read_self_admin on public.landlord_verifications
  for select to authenticated using (
    landlord_id = (select auth.uid())
    or (select private.has_role('administrator'))
  );
create policy property_verification_read_party on public.property_verifications
  for select to authenticated using (
    exists (
      select 1 from public.properties p where p.id = property_id
      and (p.landlord_id = (select auth.uid())
        or (select private.has_role('administrator')))
    )
  );
create policy enquiries_read_parties on public.enquiries
  for select to authenticated using (
    customer_id = (select auth.uid())
    or landlord_id = (select auth.uid())
    or (select private.has_role('administrator'))
  );
create policy enquiry_messages_read_parties on public.enquiry_messages
  for select to authenticated using (
    exists (select 1 from public.enquiries e
      where e.id = enquiry_id and (
        e.customer_id = (select auth.uid())
        or e.landlord_id = (select auth.uid())
        or (select private.has_role('administrator'))
      ))
  );
create policy rides_read_parties on public.rides
  for select to authenticated using (
    customer_id = (select auth.uid())
    or driver_id = (select auth.uid())
    or (select private.has_role('administrator'))
  );
create policy ride_requests_read_driver_or_ride_party on public.ride_requests
  for select to authenticated using (
    driver_id = (select auth.uid())
    or exists (
      select 1 from public.rides r where r.id = ride_id
      and (r.customer_id = (select auth.uid()) or r.driver_id = (select auth.uid()))
    )
    or (select private.has_role('administrator'))
  );
create policy payment_read_payer_admin on public.payments
  for select to authenticated using (
    payer_id = (select auth.uid())
    or (select private.has_role('administrator'))
  );
create policy reviews_read_public on public.reviews
  for select to anon, authenticated using (true);
create policy favourites_read_owner on public.favourites
  for select to authenticated using (user_id = (select auth.uid()));
create policy notifications_read_owner on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));
create policy disputes_read_parties_admin on public.disputes
  for select to authenticated using (
    opened_by = (select auth.uid())
    or (select private.has_role('administrator'))
    or exists (
      select 1 from public.rides r where r.id = ride_id
        and (r.customer_id = (select auth.uid())
          or r.driver_id = (select auth.uid()))
    )
  );
create policy audit_read_admin on public.audit_logs
  for select to authenticated using ((select private.has_role('administrator')));
create policy verification_audit_read_admin on public.verification_audit_logs
  for select to authenticated using ((select private.has_role('administrator')));

revoke all on function private.has_role(public.app_role) from public, anon;
grant execute on function private.has_role(public.app_role) to anon, authenticated;
revoke all on function private.create_auth_profile() from public, anon, authenticated;
revoke all on function private.set_updated_at() from public, anon, authenticated;
