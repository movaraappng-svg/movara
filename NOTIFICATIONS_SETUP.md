# Notification delivery setup

## Current state

The notification schema and delivery functions are local source changes. Do not enable client calls to the delivery functions in production until the migration has been applied and the functions have been deployed. Delivery requests are authenticated and are limited to notifications owned by the caller. SMS and push are opt-in; email is enabled by default until the user changes the preference.

## Provider secrets

Configure secrets in the Supabase project dashboard under **Edge Functions → Secrets**. Never put provider secrets in a browser/mobile environment file or commit them to this repository.

| Secret | Used for | Required values |
|---|---|---|
| `RESEND_API_KEY` | Email | Resend API key |
| `RESEND_FROM_EMAIL` | Email | Verified sender address |
| `TERMII_API_KEY` | SMS | Termii API key |
| `TERMII_SENDER_ID` | SMS | Approved sender ID |
| `TERMII_CHANNEL` | SMS | Optional, defaults to `dnd` |
| `TERMII_BASE_URL` | SMS | Optional, defaults to Termii Nigeria API |
| `TWILIO_ACCOUNT_SID` | SMS fallback | Twilio account SID |
| `TWILIO_AUTH_TOKEN` | SMS fallback | Twilio auth token |
| `TWILIO_FROM_NUMBER` | SMS fallback | Twilio sender number, unless using a messaging service |
| `TWILIO_MESSAGING_SERVICE_SID` | SMS fallback | Optional Twilio messaging service SID |
| `EXPO_ACCESS_TOKEN` | Expo push | Optional Expo push access token |
| `FCM_SERVICE_ACCOUNT_JSON` | Firebase push | Firebase service account JSON with FCM send permission |

Termii is preferred when its key and sender ID are both configured. Twilio is used only when Termii is not configured.

## Deployment sequence

After reviewing the SQL and approving the production change, apply migration `20261120000400_notification_platform`, then deploy `send-email`, `send-sms`, and `send-push`. Keep JWT verification enabled for all three functions. Confirm the web production origin is included in the function CORS allowlist before rollout.

For push, configure the EAS project ID and Android/iOS push credentials in the mobile app build. Push registration is not expected to work in Expo Go or without native credentials. Web push is not implemented yet.

## Operational limitation

The current clients invoke channel delivery when they receive a notification over Supabase Realtime. A user whose app is closed can miss email/SMS/push delivery. Before treating notifications as reliable production messaging, move dispatch to a server-side queue or database webhook, add retry/backoff and dead-letter handling, and monitor provider outcomes. Database notification records remain the source of in-app history.
