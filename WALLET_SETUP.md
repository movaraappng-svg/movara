# Wallet platform setup

Wallet schema, screens, and Paystack money-movement code are local changes. They rely on notification migration `20261120000400_notification_platform`, then wallet migration `20261120000500_wallet_platform`, finance migration `20261120000600_payment_refunds_reconciliation`, and payout migration `20261120000700_paystack_withdrawal_transfers`, applied in order. None of these migrations are deployed from this phase.

## Money movement controls

- Wallet balances are calculated from immutable signed ledger rows. Clients cannot set balances.
- Paystack top ups are credited only after the provider payment reference, amount, and currency are verified server-side.
- Wallet-funded rides lock the wallet, check available funds, create the ride, and debit in one database transaction.
- A wallet-paid cancellation returns the fare less any cancellation fee recorded by the ride workflow.
- Completed digital rides credit driver earnings once per ride using the commission applied to that ride. Cash rides are not settled to a wallet automatically.
- Withdrawal requests reserve funds in the ledger. The administrator payout action resolves the Nigerian account name through Paystack, compares it to the submitted beneficiary, creates/reuses a transfer recipient, and sends a Paystack balance transfer using a stable reference.
- Wallet funds remain held while a transfer is pending. Only verified success marks the withdrawal paid. A verified failure or reversal returns the held amount once. Transfer OTP approval, if enabled on the Paystack account, must be completed in Paystack before the webhook or verification can finalize it.
- Administrative ledger entries and payout decisions are role-checked and audited.

## Payment finance

Migration `20261120000600_payment_refunds_reconciliation` adds role-limited refund requests and reconciliation history. Refunds can be partial or full, and the database prevents total pending or processed refunds from exceeding the original successful Paystack charge. Refund state follows Paystack responses and webhook events.

The admin reconciliation action checks up to 100 recent Paystack charges against provider status, amount, and currency. It records differences and can repair pending payments that Paystack confirms as successful or failed. This does not yet import settlement reports or close an accounting period.

## Provider requirements

Payouts require Paystack Transfers enabled for the business and sufficient Paystack balance. Keep `PAYSTACK_SECRET_KEY` and `SUPABASE_SERVICE_ROLE_KEY` in Supabase Edge Function secrets only. Subscribe the Paystack webhook to `charge.success`, `charge.failed`, `refund.pending`, `refund.processing`, `refund.processed`, `refund.failed`, `transfer.success`, `transfer.failed`, and `transfer.reversed`.

Deploy functions `process-paystack-refund`, `process-wallet-withdrawal`, and `reconcile-payments`; redeploy `paystack-webhook` and the existing top up/ride payment functions with their latest source. Verify the provider callback URL is HTTPS and reachable. Test with Paystack test credentials before live transfers or refunds.

## Validation

Wallet SQL coverage is in `supabase/tests/006_wallet_platform.test.sql`; finance coverage is in `supabase/tests/007_payment_finance.test.sql`. These tests have not been run against a Supabase database in this environment. Also validate duplicate webhook delivery, account-name mismatch, low Paystack balance, OTP-required transfer, payout failure/reversal, partial refunds, and refund webhook retries before relying on real transactions.
