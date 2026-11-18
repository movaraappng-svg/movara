# Supabase and production setup

The React web app and Expo mobile app connect to the existing Supabase project. Their ignored local environment files contain the client URL and publishable key:

- `react-app/.env`: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`
- `mobile/.env`: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

These are public client values. Never expose a service-role key, database password or OAuth client secret in either app.

## Local use

Start the web app from the project root with `npm run dev`. Start Expo with `npm run mobile`. Do not commit `.env` files. Copy the respective `.env.example` file if setting up another machine.

## Auth provider setup

Email/password authentication uses Supabase Auth. Email confirmation and password recovery depend on the Supabase email and redirect configuration. Add each local and production app origin to Supabase Auth URL Configuration.

To enable Google sign-in and sign-up:

1. Create a Web application OAuth client in Google Cloud Console.
2. Set the Google authorized redirect URI to `https://pxplmwfmkgpbyflmtibg.supabase.co/auth/v1/callback`.
3. Enable Google under Supabase Dashboard → Authentication → Providers and enter the OAuth client ID and secret there. Keep the secret in Supabase only.
4. Add the web preview and production origins to Supabase Auth's allowed redirect URLs. Native OAuth also needs platform callback configuration.

Supabase Auth creates a user on first successful Google consent and signs in returning users. Choosing a role in the interface does not grant driver or landlord access. Those roles remain approval-gated.

## Current service boundary

The clients read published property listings, save supported profile and favourite information, and create signed-in customer ride requests. Fare values are estimates. There is no live driver matching, trip dispatch, driver tracking, payment provider, road routing, address search or production domain deployment yet. These services require trusted backend workflows and provider configuration.

Database grants, row-level security and Storage policies are the authorization boundary. Review the policies and migrations before deployment. Do not advertise unavailable flows as live services.

## Validation and launch

Run `npm run build` for the browser release bundle. Validate authentication redirects, row-level security, private Storage access, location permissions and app links in a staging environment. Configure monitoring, backups, email delivery, production domains and platform map credentials before launch.
