# Live rides, payments, and pricing

MoVara’s web ride flow supports road-based quotes, driver offers, ride tracking, Paystack checkout, and market-based fares. Ride quotes are calculated by the Supabase `route-estimate` function and signed for two minutes. The browser cannot set the fare saved on a ride.

## Fare card

Starter Nigeria rates are editable by an administrator in **Account → Pricing control**. The amounts below are the current approved starting values and are stored in kobo.

| Service | Booking | Per km | Per minute | Minimum | Cancellation | Driver commission |
|---|---:|---:|---:|---:|---:|---:|
| MoVara Economy | ₦500 | ₦130 | ₦25 | ₦1,200 | ₦500 | 10% |
| MoVara Comfort | ₦700 | ₦170 | ₦30 | ₦2,000 | ₦700 | 12% |
| MoVara XL | ₦1,000 | ₦220 | ₦35 | ₦3,000 | ₦1,000 | 15% |
| MoVara Executive | ₦1,500 | ₦300 | ₦40 | ₦5,000 | ₦1,500 | 15% |

Surge is configurable from 1.0× to 3.0× per market. Administrators can maintain zone fees and multipliers, airport surcharges, event pricing, promo and corporate codes, and driver incentives. Rain and holiday multipliers are manual inputs until trusted weather and calendar feeds are connected. Driver incentives can be limited to a service class.

## Google Maps

In Google Cloud Console, enable Maps JavaScript API, Places API (New), and Routes API for the billing project. Create separate browser and server keys:

1. Restrict the browser key to Maps JavaScript API and Places API (New), and to the deployed site and local development origins. Set it in GitHub repository **Settings → Secrets and variables → Actions → Variables** as `VITE_GOOGLE_MAPS_BROWSER_KEY`.
2. Restrict the server key to Routes API. Store it as the Supabase function secret `GOOGLE_MAPS_ROUTES_API_KEY`. Never put this key in React, a public file, or chat.

## Apply and deploy

Authenticate the Supabase CLI on the machine that will deploy, then run these from the repository root:

```powershell
supabase login
supabase link --project-ref pxplmwfmkgpbyflmtibg
supabase db push
supabase functions deploy route-estimate
supabase functions deploy request-ride
supabase functions deploy initialize-paystack-payment
supabase functions deploy verify-paystack-payment
supabase functions deploy paystack-webhook
```

The CLI login command opens the provider flow or prompts locally for a token. Do not paste a personal access token into chat.

In Supabase **Project Settings → Edge Functions → Secrets**, configure:

- `GOOGLE_MAPS_ROUTES_API_KEY`: server-restricted Routes key.
- `RIDE_QUOTE_HMAC_SECRET`: unique random value with at least 32 random bytes.
- `PAYSTACK_SECRET_KEY`: Paystack test secret until the account is approved for live payments.
- `PAYSTACK_CALLBACK_URL`: optional callback, defaults to `https://movaraappng-svg.github.io/movara/`.

In Paystack, configure the webhook URL `https://pxplmwfmkgpbyflmtibg.supabase.co/functions/v1/paystack-webhook` and subscribe to charge events. The webhook validates its signature and independently verifies transaction amount and currency.

After the browser key is added as a GitHub Actions variable, rerun **Deploy MoVara web app** from GitHub Actions. Browser keys are visible to visitors, so enforce website and API restrictions. Never put server keys in GitHub build variables.

## Driver operations

Drivers must have an approved identity and matching approved vehicle. They select an operating market before going online. Offers are limited to that market and passenger capacity. Driver location is shared only during an accepted or active ride, and requires location permission and HTTPS.

## Current rollout limits

- Paystack checkout currently supports NGN only. Adding another currency requires an enabled payment provider and country-specific compliance/configuration.
- City pricing markets must be added and priced in the admin controls before dispatch is enabled there. Google place city names are not automatically activation of a market.
- Weather and holiday surge multipliers are administrator-configured. They do not claim to be live alerts.
- Admin pricing, rides, driver flow, and payment services cannot work in the published site until the pending migration and edge functions are deployed and the provider secrets are configured.
- Delivery, cargo logistics, corporate billing workflows, wallets, refunds, support operations, and SOS still need separate product and backend work before claiming full platform parity.
