# MoVara Supabase Storage

Storage configuration is defined by the database migrations. Buckets are
private; client apps must not switch them to public to simplify
image display.

| Bucket | Visibility | Allowed formats | Maximum size | Intended path |
|---|---|---|---:|---|
| `property-images` | Private | JPEG, PNG, WebP | 10 MiB | `{property_uuid}/{landlord_uuid}/{image_uuid}` |
| `identity-documents` | Private | JPEG, PNG, PDF | 10 MiB | `{owner_uuid}/{document_uuid}/document` |
| `profile-photos` | Private | JPEG, PNG, WebP | 5 MiB | `{auth_user_uuid}/{image_uuid}.{ext}` |

## Access and upload rules

- Property image objects are readable only for published listings, their
  landlord, or an authorized administrator. An owner may upload only to an
  owned property after image metadata has been registered using the
  `register_property_image` workflow.
- Identity files are private to their subject and authorized administrators.
  Their metadata is registered through the driver/landlord document workflows.
- Profile images are private and owner-only for read, insert, update and delete.
  A later product decision may add a narrowly scoped public avatar delivery
  mechanism; the current profile table itself is owner-readable.
- Bucket-level MIME and size limits are configured in SQL. The future upload UI
  must also inspect file extension/content and enforce a size limit before
  upload; client validation supplements, not replaces, Storage policy.
- Profile-image paths must use the current Auth UUID as the first folder.
  Property and identity object paths must follow the exact forms above.

For private bucket display, request a short-lived signed URL for the authorized
object path. Do not persist signed URLs as database values: persist the object
path and request a new signed URL when needed. Signed URL lifetime and refresh
behavior belong in the eventual image repository/UI integration.

No Supabase Storage bucket has been created in a hosted project during this
task. The bucket definitions become effective only when the migrations are
applied.

