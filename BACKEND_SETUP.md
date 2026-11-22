# MoVara service and release setup

MoVara is a React web app and an Expo app for Android and iOS. Both clients use the production Supabase project through their local, ignored `.env` files. Only the Supabase project URL and publishable key belong in client apps. Keep service role keys, database credentials, payment secrets, and OAuth client secrets in Supabase secrets.

## Current production services

- The production Supabase database has migrations applied through `20261122000300`. Recent migrations repair authenticated workflow access and the support administration RPCs.
- Ride requests, signed fare quotes, configurable fare rules, airport and zone adjustments, promotions, corporate adjustments, driver approvals, and ride status workflows are implemented in Supabase.
- Road routes and address suggestions use OpenRouteService. Route API credentials stay in Supabase. Fare rules are stored in the database and can be managed from the web operations page.
- Cargo requests support operational quotes, Paystack checkout, assignment, and courier status updates. Quotes and assignments require an authorized operator.
- Home search, saved properties, landlord verification, listing review, property enquiries, and viewing conversations use the database and private storage policies.
- Paystack checkout, payment verification, refunds, wallet top ups, and withdrawal workflows are deployed. Confirm that `PAYSTACK_SECRET_KEY` is a live key before accepting real customer payments. Test keys only authorize test transactions.
- FCM credentials and the Expo project are configured for native push delivery. A customer still needs to install a current build and grant notification permission.
- Support, emergency contacts, safety reports, and operations review are available to signed-in customers and authorized staff.

Third-party channels are conditional on provider credentials. Email requires `RESEND_API_KEY` and `RESEND_FROM_EMAIL`. SMS requires Termii credentials or Twilio credentials. The app records delivery outcomes and should show a channel as unavailable until its provider is configured. Google sign-in requires the Google provider to be enabled in Supabase Auth with valid OAuth client credentials and redirect URLs.

MoVara does not dispatch emergency responders. The safety page directs customers to Nigeria's emergency number, 112.

## Local development

From the project root:

```powershell
npm run dev
npm run build
npm run mobile
```

The mobile project is in `mobile/`; the React web project is in `react-app/`. Do not commit either `.env` file. Copy the matching `.env.example` file when setting up another workstation.

## Google sign-in

1. Create a Web OAuth client in Google Cloud Console.
2. Add `https://pxplmwfmkgpbyflmtibg.supabase.co/auth/v1/callback` as an authorized redirect URI in Google Cloud.
3. Enable Google in Supabase Dashboard under Authentication, Providers, then enter the OAuth client ID and secret there.
4. Add the deployed web origin and local web origins to Supabase Auth's redirect URL allowlist. For the native app, keep `movara://auth/callback` allowlisted and ensure the Google provider redirects back through Supabase.
5. Test new-user signup, existing-user signin, email confirmation, cancellation, and signout on both web and Android.

Google first sign-in creates an Auth user. Driver and landlord permissions remain approval-gated and cannot be granted by selecting a role in the client.

## Web release

The GitHub Pages workflow builds the web app when changes to `react-app/` are pushed to `main`. Configure repository Actions variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, then check the Actions run and Pages environment after each release. The production base path is `/movara/`.

## Android release

Build an installable preview APK from `mobile/` with:

```powershell
npx eas-cli build --platform android --profile preview
```

For a Play Store release, build the `production` profile, review the signing credentials and store listing, then submit through the Play Console. Use a preview APK for device installation, not as a public Play Store release.

## Operational checks

Before taking real bookings, verify the Google Auth provider, live Paystack mode and webhook URL, email and SMS provider configuration, push delivery on a physical device, driver onboarding and approvals, live routing coverage, city fare rules, data backups, and support ownership. Never describe a test-mode payment as a completed live payment.
