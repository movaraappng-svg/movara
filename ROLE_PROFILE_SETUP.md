# Supabase role profiles

The existing migrations `20261109000100_role_profiles.sql` and `20261109000200_identity_submission_state.sql` create customer, driver and landlord profile details, self-only row-level security, and separate identity submission/review states. Profile images use the private `profile-photos` bucket and expiring signed URLs. Identity documents use the private `identity-documents` bucket and registration RPCs.

The React web app and Expo app are configured to connect to the existing Supabase project through local ignored `.env` files. See [BACKEND_SETUP.md](BACKEND_SETUP.md) for configuration and Auth provider setup. Client apps use only the publishable key, never a service-role key.

## Apply migrations

The hosted project was previously linked as `pxplmwfmkgpbyflmtibg`. To inspect migration status and apply pending SQL through the authenticated Supabase CLI:

```powershell
supabase login
supabase link --project-ref pxplmwfmkgpbyflmtibg
supabase migration list
supabase db push
```

Review the pending migration list before confirming `db push`. Alternatively, apply reviewed migration files in timestamp order through the Supabase SQL editor.

Driver and landlord privileges require administrator approval. Identity review state is distinct from a user's requested role; submitting a document does not imply verification. The administrator RPCs enforce authorization and record decisions in the audit log.
