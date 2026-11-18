# Two-session concurrency tests

The pgTAP file verifies uniqueness constraints, idempotent retries, and state
transitions serially. PostgreSQL concurrency behavior must also be exercised
against a disposable local database with two independent authenticated
connections. Do not run these scenarios on a hosted or production project.

Use the fixed fixture IDs and database setup from
`001_stage4a_security.test.sql`, committed only in a dedicated local test
transaction/database. Set valid `request.jwt.claim.sub`, `request.jwt.claims`,
and `request.jwt.claim.role` values separately for each session.

## Concurrent second confirmations

1. Start with one future `proposed` viewing, no confirmations, and a valid
   effective fee setting.
2. In session A, authenticate as the tenant and call
   `select public.confirm_property_viewing('<viewing-uuid>');`.
3. At the same time, in session B, authenticate as the landlord and call the
   same RPC. Add a short client-side delay after sending both requests so they
   contend on the cycle/enquiry advisory locks.
4. Commit both sessions.
5. Assert one `arranged` viewing, one connection outcome for the cycle, one fee
   for that outcome, and exactly one audit/event set for the transition.
6. Repeat with the confirmation order reversed and with each request retried.

Expected: no deadlock, serialization anomaly, partial confirmation, duplicate
outcome, or duplicate fee. One RPC may wait for the other; retries return the
existing outcome.

## Concurrent duplicate viewing requests

1. Submit `create_property_viewing` concurrently for the same enquiry with two
   distinct idempotency keys.
2. Commit both requests.

Expected: at most one active appointment due to the partial unique index; one
request may fail with a unique violation. Retry the winning appointment with
its original idempotency key and verify the same viewing UUID is returned.

## Concurrent fee-setting overlap

1. In two sessions, submit enabled fee-setting periods that overlap each other.
2. Commit both.

Expected: one transaction succeeds and the other fails with exclusion
violation SQLSTATE `23P01`. There must not be a moment with overlapping
enabled effective settings.

## Payment callback and dispute race

1. Concurrently invoke a verified payment callback and open a dispute for the
   same pending fee.
2. Commit both, then inspect fee, payment, and dispute state.

Expected: row locking serializes the outcomes. Either payment succeeds first
and the dispute request is rejected for a paid fee, or the dispute holds the
fee first and the payment callback is rejected. A fee must never be both
`paid` and `disputed`, and one provider event must create at most one payment
record.
