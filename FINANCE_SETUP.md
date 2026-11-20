# Payment operations setup

The payment operations screens and server functions are local source changes. They depend on notification migration `20261120000400_notification_platform`, wallet migration `20261120000500_wallet_platform`, finance migration `20261120000600_payment_refunds_reconciliation`, and payout migration `20261120000700_paystack_withdrawal_transfers`. Keep them in migration order. None of these changes have been deployed as part of this phase.

## Refunds

- Administrators can request full or partial refunds for successful Paystack payments. The database locks the payment and prevents cumulative pending or completed refunds from exceeding the original charge.
- Refunds are submitted using the Paystack Refund API with a unique local reference. A provider request timeout leaves the refund in `submitting`, so staff should reconcile that reference before creating any replacement.
- Refund rows become final only after provider response/webhook. Subscribe the configured Paystack webhook to `refund.pending`, `refund.processing`, `refund.processed`, and `refund.failed` events.

## Payouts

- An administrator starts a payout from the wallet withdrawal queue. The Edge Function resolves the Nigerian bank account name, requires it to match the submitted account name, creates/reuses a Paystack transfer recipient, and sends the transfer from the Paystack balance.
- The wallet amount remains held until a verified provider success. Verified failures return the held amount; a later Paystack reversal after success also returns it once.
- Subscribe the Paystack webhook to `transfer.success`, `transfer.failed`, and `transfer.reversed`. If transfer OTP is enabled, complete OTP approval in the Paystack Dashboard; the app leaves the wallet funds reserved until provider final status is known.
- Transfers require the business Paystack account to have Transfers enabled and sufficient Paystack balance. A blocked/unconfigured transfer cannot be made production-ready from application code alone.

## Reconciliation

The admin finance screen verifies up to 100 recent Paystack payment references against provider status, amount, and currency, then records each comparison. Verified pending charges are repaired to succeeded/failed where applicable. This is transaction-level reconciliation, not a full settlement report or accounting ledger close. Refund finality remains webhook/provider sourced.

## Deploy and verify

After review, apply migrations `20261120000400` through `20261120000700` in order, deploy `process-paystack-refund`, `process-wallet-withdrawal`, and `reconcile-payments`, then redeploy `paystack-webhook` with its wallet, refund, and transfer event handling. Configure `PAYSTACK_SECRET_KEY` and `SUPABASE_SERVICE_ROLE_KEY` as Edge Function secrets. Do not expose these secrets in client builds or chat.

Test with Paystack test credentials first. Confirm bank resolve, recipient creation, OTP behavior, transfer and refund webhook delivery/retries, idempotency under duplicate webhooks, RLS roles, wallet ledger release rules, and insufficient provider balance. SQL coverage is in `supabase/tests/007_payment_finance.test.sql`; it still needs execution against a Supabase database.
