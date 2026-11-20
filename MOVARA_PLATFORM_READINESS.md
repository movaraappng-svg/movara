# MoVara platform readiness and upgrade plan

## Product direction

MoVara is a Nigeria-first ride and property platform with a structure that can expand by market. Service availability is configured by city. The current ride fare and payment implementation supports Nigerian naira only. The older Enugu-only language in the attached brief is superseded by the later product direction.

## Codebase audit

### Existing structure

- `react-app/src/app.jsx`: web route handling, authentication, home, ride booking, property discovery, driver operations, and admin pricing. This file now contains most screens and business-flow state.
- `react-app/src/style.css`: responsive visual system and page styling. Outfit and Hugeicons are used, with Framer Motion for page transitions.
- `react-app/src/supabase.js`: web client and public environment configuration.
- `mobile/app/`: Expo routes for home, rides, homes, authentication, and root layout. These are early mobile counterparts, not yet equivalent to the web app.
- `mobile/src/`: shared text and Supabase client setup.
- `supabase/migrations/`: core user roles, property marketplace, RLS workflows, identity/vehicle foundations, ride lifecycle, payment records, and fare configuration.
- `supabase/functions/`: live route estimate, signed ride request, Paystack initialization/verification/webhook, plus shared Google Routes and fare calculation modules.

### Existing web screens and components

`app.jsx` currently defines the home page, service cards, Google Maps loader and map canvas, address suggestion field, ride booking and ride history, property list, account sign-in/sign-up, account dashboard, driver dashboard, driver join flow, and administrator fare controls. Property detail, landlord listing management, support center, corporate portal, and safety center are not complete end-user pages.

### Implemented foundation

- Supabase email and password authentication and Google OAuth entry point.
- Property discovery from published Supabase records, signed image access, role/profile and storage policy groundwork.
- Ride booking with pickup and destination selection, device location, map pin selection, scheduled pickup, passenger count, service class, and payment choice.
- Server-side road quote and signed two-minute fare token, ride request creation, driver offer matching, active ride location updates, and rider status refresh.
- Paystack checkout and webhook code for ride and post-acceptance cancellation fees.
- Four-class Nigerian fare card, market-based pricing, demand surge settings, airport/zone/event adjustments, promo and corporate codes, driver commission, and incentive fields.
- Administrator controls for rates, city activation, surge, local adjustments, and driver incentives.

### Gaps and risks

- The web app is concentrated in a large `app.jsx`. Screen state, data access, and presentation need separation before the feature set expands further.
- The Expo app is a small shell and does not yet mirror the web ride, driver, property-owner, and admin capabilities.
- Current ride operations do not provide support escalation, SOS handling, trip sharing, no-show workflows, refunds, settlement reports, or robust driver/rider dispute handling.
- Ratings and reviews exist in the database foundation but are not a full ride feedback flow.
- Saved places, favorite drivers, multi-stop rides, referrals, notifications, bank transfer, wallet, and turn-by-turn navigation are not implemented end to end.
- Delivery, freight/logistics, corporate billing, and admin operations for support, payouts, KYC, promotions, and analytics need their own workflows and permissions.
- Weather and holiday surge are admin-set. They are not live feeds. Airport and event pricing work only when an administrator configures an adjustment.
- Naira is the only supported fare currency. International currency values are blocked until local tariff math, payment settlement, and refunds support them.
- Maps and Paystack provider keys are not configured. The backend is deployed, but live route quotes and online checkout return a configuration error until their keys are installed.
- The new web build has not been published. A local preview is running at `http://localhost:5173`.

## Changes applied in this milestone

- Added the specified Economy, Comfort, XL, and Executive fare card and admin editing for every city rate.
- Added fare breakdowns and quote validation, city pricing, driver commission and earnings calculations, airport pricing, zone/event adjustments, promo/corporate discounts, incentives, and demand-based surge controls.
- Added safeguards so cities start inactive, can only be activated after all four class rates are saved, and cannot silently inherit another market’s tariff. The database currently permits Nigerian markets priced in NGN only.
- Applied production database migrations through `20261118000500` and deployed the five ride/payment Edge Functions to the linked Supabase project.
- Generated and stored the quote-signing secret directly in Supabase. No secret value is included in this repository.
- Added fare calculation tests and deployment instructions.

## API and database changes

### Supabase functions

- `route-estimate`: Google Routes road distance and ETA, city/service tariff lookup, adjustments, fare calculation, and signed short-lived quote.
- `request-ride`: verifies the signed quote and rider inputs, then creates the ride using server-calculated pricing.
- `initialize-paystack-payment`: starts payment for an accepted ride or cancellation fee.
- `verify-paystack-payment`: verifies a returned Paystack reference.
- `paystack-webhook`: validates Paystack signatures and updates payment state.

### New data areas

- Per-city `ride_pricing_rules` with booking fee, distance/time rates, minimum, cancellation fee, and commission percentage.
- `ride_cities` and `ride_surge_settings` for market activation and bounded surge configuration.
- `ride_pricing_adjustments` for zone, airport, event, corporate, promo, and incentive data.
- Ride columns for city, currency, fare adjustments, cancellation fee, commission, incentive, and driver earnings.
- Payment type for ride and cancellation-fee transactions.

## Refactoring opportunities and recommended structure

Move away from the single-file screen module in small, behavior-preserving steps:

```text
react-app/src/
  app/                 # routing, providers, shared layout
  features/auth/       # auth screens and session handling
  features/rides/      # booking, map, history, ride details
  features/driver/     # onboarding, availability, trip operations
  features/properties/ # search, details, owner listing workflows
  features/admin/      # pricing, support, payouts, moderation
  components/          # shared fields, buttons, cards, dialogs
  services/            # Supabase queries and function clients
  domain/              # fare and status models, validation
  styles/              # tokens and component styles
```

Keep money calculations on trusted backend functions. Put database calls behind feature services, add typed row/function contracts, and keep permission checks in RLS and server functions. Do not make hidden UI controls the security boundary.

## Missing product features by priority

### Ride launch essentials

- Test Google Maps JavaScript/Places/Routes with restricted keys and billing limits.
- Complete rider and driver journeys with deployed-provider end-to-end checks.
- Expire or recover abandoned Paystack checkouts, reconcile webhook/payment states, and add refund/dispute operations.
- Build trip sharing, SOS escalation, emergency contacts, incident reporting, lost-item handling, and support ticketing.
- Add driver offer timeout/retry, no-show, cancellation, and scheduled-ride operating procedures.
- Add driver identity/document expiry review, ratings, navigation, payout statements, and settlement reconciliation.

### Marketplace expansion

- Finish property detail, owner listing management, listing moderation, saved searches, appointment scheduling, and landlord/renter support.
- Add referrals, push/email/SMS notifications, favorite drivers, saved places, multi-stop rides, and ride reviews.
- Build delivery and logistics flows with parcel/cargo attributes, proof of pickup/dropoff, recipient updates, insurance/claims, and dispatch rules.
- Build corporate account membership, employee limits, ride policies, invoices, monthly billing, and expense reports.
- Build admin analytics, user/KYC management, fleet tools, support queue, payout reconciliation, promotion management, delivery operations, and audit-log views.
- Before international launch, add country-specific currency-aware fare columns, payment provider settlement, localization, compliance, support, and market-level availability.

## Upgrade sequence

1. Add the server-restricted Google Routes key and public browser Maps key. Use separate keys and quotas.
2. Add a Paystack test secret, webhook configuration, then exercise success, failure, duplicate, abandoned, refund, and cancellation flows in test mode.
3. Publish the React web build after the browser key and GitHub Pages variable are configured.
4. Run authenticated RLS checks as customer, driver, administrator, and anonymous user. Add SQL tests for pricing, dispatch, payment transitions, and market activation.
5. Complete safety and support flows before accepting public rides.
6. Finish property-owner operations and core marketplace messaging.
7. Deliver corporate and logistics modules as distinct products with their own data models and operating policies.
8. Enable each new city only after rates, verified drivers, customer support, payment settlement, and incident response are ready.

## Production handoff

The database migrations are applied and the five functions are active in Supabase. The quote signing secret is installed. The remaining launch credentials are `GOOGLE_MAPS_ROUTES_API_KEY` and `PAYSTACK_SECRET_KEY` in Supabase Edge Function secrets, plus `VITE_GOOGLE_MAPS_BROWSER_KEY` in GitHub Actions variables. Do not paste any of these values into chat or source control. The setup steps are in `LIVE_RIDES_SETUP.md`.

After those keys are installed, verify Maps website/API restrictions, Paystack webhook signature and test transactions, auth redirect URLs, ride lifecycle policies, backups, monitoring, privacy/terms, support contacts, and the production website build before taking real payments.
