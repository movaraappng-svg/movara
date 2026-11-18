# MoVara database security policies

All database access is designed for Supabase's `anon`/`authenticated` client
roles with Row Level Security enabled. The service-role key is for trusted
server operations only and must never be embedded in web or mobile client apps.

## Authentication and role authorization

- Supabase Auth is the source of user identity. `auth.uid()` is compared with
  profile/owner/participant columns in policies.
- Auth signup creates a profile and the default customer role.
- Driver and landlord privileges require role approval. Clients can request
  these roles through `request_marketplace_role`; they cannot write `user_roles`
  or approve themselves.
- Administrator provisioning and payment callbacks are restricted to
  `service_role` operations.
- Client-side role guards are not a security boundary.

## Row access summary

| Data | Read | Write |
|---|---|---|
| Profiles | Own profile | Own display name, phone and avatar path only |
| Properties | Published rows; owner/admin may read their own | Authorized landlord may create draft rows and edit permitted listing fields; delete is limited to own image-free draft/rejected rows |
| Property images | Published property, owner or admin metadata | Trusted registration workflow and the owning landlord's constrained object path |
| Favourites | Own rows | Authenticated customer may save a published property or remove their own save |
| Rides | Customer, assigned driver or administrator | Customer may create a requested ride with no driver/vehicle assignment; dispatch/status transitions are server workflows |
| Ride requests | Offered driver or ride participants | Driver acceptance/rejection is not a direct table write |
| Driver profiles | Own driver record/admin | Driver may create an offline profile; availability may be updated by its owner. Going online requires approved driver verification and an approved vehicle |
| Notifications | Recipient only | Trusted workflows create them; recipient may update only their own read timestamp |
| Identity documents | Subject and authorized administrator | Subject uploads only under their own private object path; workflow records metadata |

`profiles`, `properties`, favourites, rides, driver profiles and notifications
have database grants as well as RLS policies; both layers are required. The
property insert grants omit moderation status columns, so new client-created
properties use the `draft` default. Clients cannot publish a listing by changing
its status. Driver verification status and vehicle approval are also not client
writable.

The existing workflow migration uses a non-login, non-`BYPASSRLS` function owner
with restricted table grants for security-definer RPCs. Functions use an empty
search path, qualified object names, explicit actor checks and explicit
execution grants. Review the SQL before deployment; this is not a substitute
for applying and exercising policies in a local database.

## Storage controls

- Property photographs and identity documents are private buckets.
- Property image paths include property and landlord IDs; reads require a
  published property, owner, or administrator. Uploads require ownership and a
  registered image row.
- Identity documents are private to the subject and authorized administrators.
- Profile photos are private, limited to 5 MiB and JPEG/PNG/WebP; object paths
  begin with the authenticated user's UUID. This first phase does not make
  profile photos publicly readable.
- Web and mobile clients receive no administrative Storage/database credential.

## Validation status

The SQL migrations and pgTAP files are review assets. They were not deployed or
run against PostgreSQL as part of this phase. Before launch, apply to a
disposable local Supabase instance, run the pgTAP and concurrency suites, inspect
RLS/grants/Storage access under `anon` and multiple `authenticated` identities,
and then repeat in staging. See
[BACKEND_SETUP.md](./BACKEND_SETUP.md) for commands.

