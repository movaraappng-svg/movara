# MoVara codebase audit

Audit scope: the active React/Vite web client, Expo mobile client, Supabase migrations, and Edge Functions in this repository. The audit distinguishes code present in the repository from features proven active in the linked production project. A local implementation is not marked production-complete until its migration and function are deployed and verified.

## Existing and partially implemented features

| Area | Status | Evidence and limits |
|---|---|---|
| Web authentication | Partial | Supabase email/password and Google OAuth UI exist. Provider configuration, redirect domains, recovery flow, and production auth checks are external requirements. |
| Ride booking and route quote | Partial | Web ride booking, Places, current location, map pins, Google Routes Edge Function, fare token, scheduling, payment choice, and history are implemented. Provider secrets are still needed and actual end-to-end quotes are not verified. |
| Dispatch and driver operations | Partial | Driver onboarding, identity/vehicle checks, online status, open-ride acceptance, lifecycle transitions, live location, basic earnings, and arrival/no-show lifecycle are present. Nearest-driver radius ranking, targeted offer expiry/retry, scheduled dispatch, reassignment, payout, and turn-by-turn navigation remain absent. |
| Fares and promotions | Partial | Four ride classes, city rules, adjustments, surge, promos/corporate code fields, and incentive calculations exist. Corporate account controls and operational pricing audit/reporting are absent. |
| Paystack | Partial | Initialize, verify, and webhook functions exist, with signature verification and unique active payment guard. Abandoned checkout recovery, refunds, settlement reconciliation, and finance operations are absent. Paystack credentials are not confirmed installed. |
| Property marketplace | Partial | Published listing search supports state, category, rent/sale, keyword, and price filters. Listing detail and image gallery, saved homes, secure enquiry, viewing request, party-scoped conversation inbox, landlord listing creation/edit/photo uploads, and admin listing review queue are implemented. Migration `20261120000200_landlord_property_submission` is applied to the linked project; agent verification UX and end-to-end viewing tests remain. |
| Ride safety and support | Implemented foundation | Emergency contacts, safety events, trip shares, support tickets, rating, and admin workflows are implemented. Migration `20261120000100_ride_safety_support` and `shared-ride` were deployed to the linked Supabase project; full role-based production security tests remain outstanding. |
| Mobile | Partial, improved | Expo ride booking requests live route and fare quotes, submits signed requests, shows ride history, cancels rides, and opens Paystack checkout. Profile editing, safety contacts/tickets, home search, saved homes, listing details, enquiries, property inbox, driver onboarding, vehicle submission, ride offers, trip actions, earnings, landlord verification, property submission, photo uploads, and listing status are connected. Payment return verification and admin parity remain incomplete. |
| Notifications | Partial, platform foundation added locally | Notification center and preference controls exist on web and Expo. New local migration adds preference, device, delivery-log, deduplication, and ride/viewing/verification/support/SOS notification workflows. Three authenticated Edge Functions deliver email, SMS, and push through configured providers. The migration and functions are not yet deployed, provider secrets are not confirmed, and delivery is currently initiated by an online client's realtime listener rather than a durable background queue. Push also needs EAS/Firebase platform setup. |
| Wallet | Partial, platform foundation added locally | New local wallet migrations add immutable ledger-derived balances, Paystack top ups credited after server verification, atomic wallet-funded ride booking, cancellation credits, digital ride earnings, payout holds/releases, admin adjustments, and web/mobile wallet pages. New Edge Functions initiate/refetch Paystack transfers after account-name resolution. This is not deployed. Business Transfers enablement, webhook delivery, and test/live verification remain external requirements. Cash ride earnings are not automatically settled to wallet. |
| Payments, refunds, reconciliation | Partial, finance foundation added locally | New admin finance page creates full/partial Paystack refunds with locked cumulative limits, records provider status, and reconciles up to 100 recent transactions by reference, status, amount, and currency. It is not deployed and does not yet import Paystack settlement reports or provide a complete accounting close. |
| Admin operations | Partial | Role-protected pricing, support/safety, property review, wallet withdrawal and adjustment, payment/refund, and reconciliation tools exist in local source. User/driver/property/payment/refund/payout/logistics analytics and full operations reporting remain absent. |

## Missing product areas

- Multi-stop rides, saved places, favourite drivers, rebooking, referral program, and end-to-end notification delivery.
- Driver document expiry, shift history, streaks, wallet, payout reports, turn-by-turn navigation, driver support, and dispute tools.
- Dispatch distance/radius ranking, retry windows, driver offer timeout, scheduled dispatch, reassignment, payout, and operational cancellation handling. Arrival/no-show is now represented by migration `20261120000800_driver_arrival_no_show.sql`; no-show reports do not apply a fee, and Paystack refunds still require the existing admin refund workflow.
- Settlement report imports and accounting close; the new transaction-level reconciliation, refunds, and Paystack transfer workflows are local and not deployed.
- Corporate account membership, departments, limits, budgets, approvals, monthly billing, and invoices.
- Delivery, cargo, freight and shipment models, proofs, OTP delivery, recipient updates, tracking, and fleet assignment.
- Verified-agent experience and broader appointment management.
- Admin dashboards for users, drivers, vehicles, rides, payments, refunds, wallets, corporate, delivery, cargo, analytics, and audit logs.
- Mobile feature parity with web.

## Security and integrity findings

1. Production migrations and Edge Function deployment are separate from source changes. `20261120000100`, `20261120000200`, and `20261120000300_driver_vehicle_submission` are applied. The notification migration `20261120000400_notification_platform` remains local and requires a separate production approval.
2. Safety event and support records must not be directly readable or writable by normal authenticated clients. Admin screens now call role-checking RPCs; validate function ownership and role grants in the target database after migration.
3. The current public shared-trip endpoint uses an 8-hour bearer token. Treat the token as a secret. The endpoint returns route labels and current driver coordinates only, without name, phone, or account identifiers. Add per-token throttling and audit access before broad public launch.
4. SOS creates a platform record and starts the device dialler for 112. It does not call emergency services or notify emergency contacts automatically. Do not describe this as monitored emergency dispatch.
5. Emergency contacts are stored as account data. Contact alerts by SMS/call are not implemented. Apply privacy notice and retention requirements before collecting at scale.
6. RLS and SQL security-definer ownership are core controls. Test customer, driver, administrator, and anonymous access with Supabase tests after deployment. Client route guards alone are not security controls.
7. Paystack webhook validates HMAC signatures and payment rows have database uniqueness guards. Verify transaction amount/currency against the initialized record and review idempotency for concurrent duplicate webhook delivery before production money flow.
8. App data fields rendered as React text are escaped by React. No raw HTML rendering was found in the inspected app code. Continue to validate user-generated data server-side and enforce CSP and origin restrictions at hosting.
9. The mobile app opens Paystack checkout, but does not yet resume the app with a deep-link payment status view. Keep webhook verification authoritative and add a tested return flow before relying on client payment state.
10. Market support remains NGN-specific in fare and settlement behavior. International launch requires currency-aware ledgers, local pricing, providers, compliance, and localization.

## Changes made in this audit pass

- Added schema and controlled RPCs for emergency contacts, share links, safety events, customer support tickets, and one-time ride feedback.
- Added a `shared-ride` Edge Function with a minimal public response and expiring/revocable bearer token lookup.
- Added React ride actions, account safety center, support history, admin support and safety queue, public trip view, and ride rating.
- Changed customer and administrator ticket/event views to scoped RPCs with server-side authorization.
- Added responsive styling for safety and support screens.
- Added property filters, listing details and photo gallery, favourites, secure enquiry and viewing requests, and party-scoped conversation inbox.
- Added an administrator property review queue that uses the role-checked review RPC and respects landlord identity verification.
- Added landlord listing submission, editing, photo upload, and status tracking using a role-checked RPC and owner-scoped RLS policies.
- Replaced mobile's provisional ride request with live route quotes and trusted request submission; added mobile safety/support, property search/details/inbox, and basic profile editing.
- Added mobile driver application, private identity upload, vehicle submission for admin review, online availability, ride offers, trip status actions, location sharing for active trips, and daily earnings summary.
- Added mobile landlord application and identity upload, Nigerian state/LGA selection, rent/sale listing submission, private photo uploads, and listing review status.
- Added the authenticated `submit_driver_vehicle` RPC, restricted to drivers with approved identity; new vehicle rows remain pending for administrator approval.
- Added a local notification platform migration with event deduplication, per-kind/channel preferences, push device registration, delivery history, role-checked admin announcements, and database notification triggers for rides, property viewings, verification decisions, support tickets, and SOS reports.
- Added web and Expo notification centers with unread/read controls, channel preferences, delivery history, and an admin broadcast form.
- Added authenticated `send-email`, `send-sms`, and `send-push` Edge Functions using Resend, Termii/Twilio, Expo Push, or Firebase FCM. The delivery handler honors opt-in preferences and logs hashed destinations, not raw addresses or phone numbers.
- Added `supabase/tests/005_notification_platform.test.sql` for schema, RLS, RPC grants, and lifecycle triggers.
- Added a local wallet migration with immutable signed ledger entries, derived balances, wallet top up and withdrawal flows, atomic wallet ride payment, cancellation refund credit, driver earning credits for settled online rides, and administrator adjustment/withdrawal controls.
- Extended Paystack initialization, webhook, and verification paths so top ups are credited only by an idempotent service-only database RPC after provider verification.
- Added web and Expo wallet pages for balance, statement, Paystack top ups, withdrawal requests, and withdrawal history; the administrator web view initiates and verifies Paystack payouts, while preserving an audited resolution path for older manual requests.
- Added `supabase/tests/006_wallet_platform.test.sql` for wallet RLS, mutation grants, and settlement triggers.
- Added local payment finance migration for admin-authorized, partial/full Paystack refunds with cumulative refund limits, transaction-level reconciliation history, and provider-backed wallet payout settlement.
- Added deduplicated customer in-app notifications and audit entries when provider refund status changes.
- Added `process-paystack-refund`, `process-wallet-withdrawal`, and `reconcile-payments` Edge Functions. Payout initiation verifies Nigerian account name through Paystack, uses stable transfer references, and holds funds until verified success/failure/reversal.
- Extended the Paystack webhook to record refund progress and settle transfer success, failure, and reversal events through an idempotent service-only ledger RPC.
- Added the web admin finance page for payment review, refund initiation/history, and expandable reconciliation results. Replaced manual payout completion in the wallet admin queue with Paystack initiation/status verification.
- Added the Paystack transfer path for wallet withdrawals, including account resolution/name matching, stable transfer references, webhook verification, and idempotent release on confirmed failure or reversal. Older manual withdrawals are marked and handled separately.
- Added `FINANCE_SETUP.md` and `supabase/tests/007_payment_finance.test.sql`.
- Removed a duplicate `calculateGoogleRoute` export from the shared Edge Function module that prevented the live ride request bundle from compiling.

## Verification and deployment state

- `npm run build`: passed with the admin finance, refund, payout, and reconciliation screens.
- `npx expo export --platform android`: passed with mobile wallet and payout copy updates (9.6 MB Android bundle).
- `git diff --check`: passed; Git reported only line-ending normalization notices for existing files.
- `node --test supabase/functions/_shared/fare-engine.test.mjs`: 4 passed.
- esbuild syntax parsing passed for refund, payout, reconciliation, and Paystack webhook Edge Functions. This is not a Deno type check.
- The current local Vite preview responds on `http://localhost:5173/`.
- Migrations `20261120000100`, `20261120000200`, and `20261120000300` and the `shared-ride` endpoint are applied to the linked Supabase project. Notification migration `20261120000400` and its three delivery functions are local only. Production database role tests remain outstanding because local Docker is unavailable.
- Wallet migration `20261120000500` and the `initialize-wallet-topup` function are local only. The existing Paystack webhook and verification functions have local wallet-top-up branches; production versions remain unchanged.
- Payment finance migrations `20261120000600` and `20261120000700`, plus refund, payout, and reconciliation functions, are local only. Enable Paystack Transfers, configure webhook event subscriptions, and deploy only after test-mode bank resolve, refund, transfer OTP, and reversal paths are verified.
- The new pgTAP notification, wallet, and finance test files are authored but not executed. Supabase CLI is installed, but Deno and Docker are unavailable in this environment, so local database tests/migration validation and Deno Edge Function type checking could not run.
- Notification delivery cannot be described as production-ready until the migration and functions are deployed, provider secrets are configured, email/SMS/push provider accounts are verified, and delivery is moved to a durable server-side queue so offline clients do not miss events.
- Full end-to-end authentication, provider, payment, and RLS role testing has not been completed.

## Recommended implementation order

1. Run authenticated customer, landlord, driver, administrator, and anonymous RLS/RPC tests against the linked project.
2. Deploy the notification migration/functions after approval and provider setup; add durable server-side notification dispatch and provider retry handling.
3. Add mobile payment return verification and continue landlord/admin mobile parity.
4. Add targeted driver offer expiry/retry, scheduled dispatch, and reassignment. Arrival/no-show is implemented locally in `20261120000800_driver_arrival_no_show.sql` and both driver clients; verify after local migration reset.
5. Run finance migrations and pgTAP coverage in an isolated Supabase environment, then test Paystack test-mode refunds, transfer verification/OTP/reversal, and webhook replay before deployment.
6. Import Paystack settlement reports and add accounting close, provider-level ledger reconciliation, and dispute review.
7. Complete verified-agent workflows and broader property appointment management; the marketplace review and landlord listing screens now exist.
8. Treat corporate, delivery, and cargo as separately scoped products with dedicated models, operational controls, notifications, and test plans.
9. Add admin metrics after the underlying event lifecycle is stable.
10. Publish only after provider secrets, auth redirects, domain restrictions, terms/privacy, incident operations, monitoring, and backup procedures are verified.
