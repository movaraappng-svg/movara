# MoVara

MoVara now uses React for the browser app and Expo React Native for iOS and Android. Both clients connect to the existing Supabase project using the project URL and publishable key stored in their ignored local `.env` files.

- `react-app/` is the React web experience with Outfit, Hugeicons, Framer Motion and OpenStreetMap.
- `mobile/` is the Expo app with native navigation, Supabase Auth, location and maps.
- `supabase/` contains the existing project migrations and configuration for both client apps.

## Start the browser app

From the project root:

```powershell
npm run dev
```

Open the local address shown by Vite, usually `http://127.0.0.1:5173`. Run `npm run build` to create the production web bundle.

## Start the mobile app

```powershell
npm run mobile
```

Scan the Expo QR code with Expo Go, or press `a` to open an Android emulator. iOS simulator launch requires macOS. Android production maps require a Google Maps Android API key in the native build.

## Supabase configuration

The existing project URL and publishable key are set in `react-app/.env` and `mobile/.env`. These files are local and ignored by Git. The publishable key is intended for client apps. Never put a service-role key, database password or OAuth client secret in a client app.

Google sign-in requires the Google provider credentials in Supabase Auth and redirect URLs allowlisted for local and deployed app origins. See [BACKEND_SETUP.md](BACKEND_SETUP.md).

## Service availability

Authentication, profiles, property browsing and the supported Supabase-backed flows connect to the existing project. Ride fares are estimates; driver dispatch, live tracking and payments need trusted backend and provider integrations before they can be offered. See [BACKEND_SETUP.md](BACKEND_SETUP.md) for the current service boundary and production setup.
