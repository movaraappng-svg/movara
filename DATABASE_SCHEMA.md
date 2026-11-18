# MoVara database schema

The authoritative DDL is in ordered files under `supabase/migrations/`. This
document summarizes that schema; it does not claim that a database has been
deployed.

## Identity and roles

- `auth.users` is the single authentication identity.
- `profiles.id` is a one-to-one UUID foreign key to `auth.users.id`.
- An Auth trigger creates a profile and grants the initial `customer` role.
- `user_roles` has a composite `(user_id, role)` primary key. One account may
  hold multiple separately authorized roles; role selection never creates a
  second account.
- `role_requests` stores customer requests for the `driver` and `landlord`
  roles. Approval and role assignment are trusted-server/admin actions.
- `driver_profiles` (migration 004) stores driver availability. Its primary key
  is the profile UUID; online status defaults to false. Vehicle and verification
  facts remain in `vehicles` and `driver_verifications`.

## Marketplace

- `properties` belongs to one `landlord_id` profile. It stores a listing title,
  description, category, rent/sale type, status, verification state, address,
  Nigerian state/LGA/neighbourhood identifiers, bedroom/bathroom counts, and
  integer `price_ngn_kobo` with `currency = 'NGN'`.
- Web and mobile price filters convert integer Naira to kobo before querying.
- `property_images` references both the property and its owning landlord and
  stores a private Storage object path and display order.
- `favourites` uses `(user_id, property_id)` as its primary key to prevent
  duplicate saves.
- Location catalogs are `nigerian_states`, `nigerian_lgas`, and
  `neighbourhoods`.
- `enquiries` and `enquiry_messages` represent property conversations.

## Rides and notifications

- `rides` references its customer and, once assigned, an optional driver and
  vehicle. It stores pickup/destination labels, passenger count, Naira fare
  values in kobo, and a constrained ride status.
- A composite vehicle/driver foreign key ensures an assigned vehicle belongs
  to the assigned driver.
- `ride_requests` represents offers to individual drivers and has one row per
  ride/driver pair. Driver response and trip status mutations are not client
  table writes; a matching/dispatch workflow must be supplied separately.
- `notifications` belongs to one recipient profile and stores a kind, JSON
  payload, creation timestamp and optional read timestamp.

## Related existing domains

The prior migration package also includes driver vehicles and verification,
landlord/document/property verification, payments, reviews, disputes, audit
records, enquiries, property viewings, reschedules, tenancy search cycles,
connection outcomes and landlord connection-fee records. Their design and
unresolved product decisions are documented in
[supabase/README.md](./supabase/README.md).

## Constraints and indexes

- UUID keys are generated with PostgreSQL `gen_random_uuid()` where rows are
  created by the database; user-owned primary IDs reference Supabase Auth UUIDs.
- Foreign keys enforce profile ownership and property/image consistency.
- Check constraints constrain enum-like values, positive monetary amounts,
  passenger counts, ratings and bedroom/bathroom counts.
- Search indexes cover published property filters by state, LGA, transaction
  type, category and kobo budget.
- Property-image ordering and driver-online filtering have supporting indexes.
- Owner/status/time indexes support landlord lists; participant/time indexes
  support ride, enquiry and notification history.
- Realtime publication membership is added for rides, driver profiles and
  notifications when the Supabase-managed publication exists.

## Currency and availability

All amounts are integer kobo with an explicit `NGN` currency constraint. The
frontend currently enters whole Naira values; the adapter multiplies those by
100. Rental billing period is not modeled yet and must be decided before
publishing rental offers. Property `listing_status` distinguishes draft,
pending review, published, paused, rented and rejected; only the trusted
moderation workflow may publish/reject listings.

