# Track 5 - Stripe / Xero integrity deep dive

## Summary

Commits deep-dived (6):

- `228f24e` Add durable Stripe payment recovery
- `ee46e2e` Cancel superseded zero-dollar booking intents
- `7932719` Implement in-progress future-night booking edits
- `92d1125` Add Xero booking edit settlement policy
- `8c0a9ec` Add Xero handling for membership cancellations
- `7acb4de` Add admin membership cancellation review (wires the Xero outbox to the approval)

Findings: 1 critical, 4 high, 4 medium, 3 low.

## Findings

### [CRITICAL] Membership cancellation never triggers a Stripe refund

- **Location**: `src/lib/membership-cancellation-admin.ts:601-727`, `src/lib/membership-cancellation-xero.ts:171-237`
- **Money / sync risk**: When an admin approves a cancellation participant, the worker only credits a Xero invoice that is `UNPAID` or `OVERDUE` (`shouldCredit` guard in `membership-cancellation-xero.ts:171`). If the season subscription is already `PAID`, no credit note is created in Xero and, more importantly, no Stripe refund is fired anywhere in the codebase. Searching the new modules confirms there is no `processRefund` / `refundPaymentTransactions` call in any membership cancellation path. The admin email tells the member their membership is cancelled, but the money sits in Stripe and Xero remains in a closed-paid state.
- **Trigger**: Member paid their annual subscription, then cancels mid-season and is approved.
- **Suggested fix**: Either (a) explicitly document that paid subscriptions are not refunded and surface this in the admin UI confirmation copy, or (b) add a paid-subscription branch that issues a Stripe refund via the existing `payment-transactions.refundPaymentTransactions` pipeline and a Xero credit note allocated against the paid invoice. If (a), at minimum block silent no-ops and log/alert when `shouldCredit` is false but the subscription was paid.
- **Commit**: `8c0a9ec`, `7acb4de`
- **Acceptance**: Add a test in `membership-cancellation-xero.test.ts` asserting the behaviour for a `PAID` subscription is explicit (either refund + credit note, or a blocked/flagged outcome), not a silent skip.

### [HIGH] Recovery queue runs even when the booking transaction succeeded but pre-recovery queue writes fail silently

- **Location**: `src/app/api/bookings/[id]/modify/route.ts:783-791` and `src/lib/payment-recovery.ts:96-116`
- **Money / sync risk**: `enqueuePaymentIntentCancellationRecovery` is called inside the booking transaction with `store: tx`. Good. But the immediate processor call at `modify/route.ts:881-889` runs OUTSIDE the transaction and is wrapped in `try/catch` that only logs. If the in-process attempt fails AND the cron worker is not configured/running (cron processor is only triggered by external POST to `/api/cron/payments?task=recovery` per `src/app/api/cron/payments/route.ts`), the queued op sits until somebody runs the cron. There is no automatic scheduler in the repo.
- **Trigger**: Production deploy without an external scheduler hitting the cron endpoint. The user does a zero-dollar batch edit. PaymentIntent is never cancelled until a scheduler is wired up, costing Stripe authorisation holds and customer confusion.
- **Suggested fix**: Document the cron contract in `docs/` and add a deployment check that fails the build/health-check if no scheduler is configured. Optionally fire-and-forget `processPaymentRecoveryOperations` from the webhook so a Stripe-driven event re-drives the queue.
- **Commit**: `228f24e`, `ee46e2e`
- **Acceptance**: Add an ops checklist item; alert if a `PaymentRecoveryOperation` row is older than 15 minutes and still `PENDING`.

### [HIGH] modify-dates abandoned additional PaymentIntents are orphaned

- **Location**: `src/app/api/bookings/[id]/modify-dates/route.ts:505-531`, mirrored in `src/app/api/bookings/[id]/modify/route.ts:926-955`
- **Money / sync risk**: When a member modifies a paid booking that requires extra payment, the server creates a `modification_additional` PaymentIntent and returns the client secret. If the user closes the browser without confirming, there is no reconciliation job that cancels stale `modification_additional` intents. The intent will be auto-cancelled by Stripe after 24 hours, which is fine for the customer's card hold but means our `PaymentTransaction` row stays `PENDING` forever unless `payment_intent.canceled` fires. The webhook handler at `webhooks/stripe/route.ts:412-464` does mark it FAILED on that event - so this is partially mitigated - but only if the webhook is delivered. There's no scheduled sweep equivalent to the new `payment-recovery` queue for these.
- **Trigger**: User abandons supplementary payment, Stripe webhook delivery fails or is delayed, booking is then modified again - the booking now has an old `additionalPaymentIntentId` referenced on the Payment row pointing at a stale intent.
- **Suggested fix**: Add an `enqueuePaymentIntentCancellationRecovery` call right when a new additional intent supersedes a prior one (i.e., when `payment.additionalPaymentIntentId` is being overwritten in `modify-dates` or `modify`), or add a periodic reconciler that fetches `PaymentTransaction` rows in PENDING for >24h and queries Stripe.
- **Commit**: `7932719` (and earlier)
- **Acceptance**: Test for "second modify-dates supersedes prior additional intent" - assert the old intent is queued for cancellation.

### [HIGH] modify-dates does not queue cancellation for stale primary intents on zero-dollar outcomes

- **Location**: `src/app/api/bookings/[id]/modify-dates/route.ts:268-371`
- **Money / sync risk**: The new pattern in `modify/route.ts:762-792` finds `PaymentTransaction` rows with `kind=PRIMARY` and `status in [PENDING, PROCESSING]` and queues cancellation when the booking drops to zero. `modify-dates` only changes dates and does not currently support a path to zero-dollar (dates alone don't go to zero), so this is unlikely in practice, but if a future change adds promo recalculation here, stale intents will accumulate. Lower severity because the date-only flow can't currently reach zero finalPrice.
- **Trigger**: Hypothetical extension; today's date-only path is safe because dates alone cannot produce zero-dollar bookings.
- **Suggested fix**: Extract the zero-dollar superseded-intent cleanup from `modify/route.ts:738-792` into a helper that both endpoints call, so the invariant is enforced symmetrically.
- **Commit**: `ee46e2e`
- **Acceptance**: Test that calling both endpoints with PENDING primary intents and zero final price queues a cancellation.

### [HIGH] Recovery operation does not re-enqueue itself when refund processing hits a transient Stripe error

- **Location**: `src/lib/payment-recovery.ts:436-475`
- **Money / sync risk**: If `processRefund` succeeds but the subsequent `recordStripeRefundLedgerEntry` or `prisma.paymentTransaction.update` fails (network blip, DB contention), the operation throws to `failPaymentRecoveryOperation`, which marks it FAILED and schedules a retry. On retry, `processRefundSupersededPaymentOperation` calls `processRefund` again - critical: it does pass the same `idempotencyKey` (line 444) so Stripe will return the existing refund, but our local `refundedAmountCents` calculation at line 454-460 will see the previous `refresh` and add `refund.amount` cumulatively. Combined with idempotent Stripe return that gives back the same refund.amount, the math is `min(refreshedTransaction.amountCents, max(refundedAmountCents, refundedAmountCents + refund.amount))` so the second pass can double-count if the first pass committed the update partially.
- **Trigger**: DB write fails after Stripe refund succeeds and after ledger entry is recorded but before the transaction status update completes. Recovery retries.
- **Suggested fix**: Move the cap (`Math.min(amountCents, refundedAmountCents + refund.amount)`) inside an atomic update that uses the current row's `refundedAmountCents` rather than the pre-read value, or guard against double-recording by querying ledger entries by refund id before writing.
- **Commit**: `228f24e`
- **Acceptance**: Test that simulates a DB error between `recordStripeRefundLedgerEntry` and `paymentTransaction.update`, then re-runs the operation; final `refundedAmountCents` must equal `refund.amount`, not double.

### [MEDIUM] Stale processing reset interacts with attempts cap

- **Location**: `src/lib/payment-recovery.ts:262-280`
- **Money / sync risk**: `resetStaleProcessingOperations` only resets rows where `attempts < MAX_PAYMENT_RECOVERY_ATTEMPTS`. If a worker dies mid-processing on attempt 5 (which has already been incremented in `claimPaymentRecoveryOperation`), the row sits in PROCESSING forever and the alert fires only via the catch path - never via timeout. No admin alert is sent for the timed-out terminal attempt.
- **Trigger**: Worker crashes while processing the 5th attempt.
- **Suggested fix**: When `attempts >= MAX` and `processingStartedAt` is older than the threshold, mark FAILED with `nextRetryAt = null` and call `alertPaymentRecoveryFailure`.
- **Commit**: `228f24e`
- **Acceptance**: Test: pre-seed a PROCESSING op with attempts=5 and stale processingStartedAt; run the worker; expect admin alert and FAILED with `nextRetryAt = null`.

### [MEDIUM] Recovery limit can be lower than queue depth when multiple zero-dollar mods run in parallel

- **Location**: `src/app/api/bookings/[id]/modify/route.ts:879-890`
- **Money / sync risk**: After a zero-dollar batch modify, the route synchronously calls `processPaymentRecoveryOperations({ limit: supersededPrimaryPaymentIntents.length })`. The queue is global - the worker will pick up the N oldest ready ops, which may be from other bookings. If many bookings are processed concurrently, some ops may be processed multiple times by overlapping callers (claim is atomic so safe) but others may be deferred to cron. Not a correctness issue, more of a starvation/observability one.
- **Trigger**: Many concurrent batch-modify-to-zero events.
- **Suggested fix**: Either pass operation IDs to a targeted variant, or accept the cron worker as the authoritative driver and remove the inline processor call (keep only as best-effort).
- **Commit**: `ee46e2e`
- **Acceptance**: Load test with concurrent zero-dollar modifications.

### [MEDIUM] Xero booking-edit settlement does not detect when the supplementary invoice waits forever

- **Location**: `src/lib/xero-booking-edit-settlement.ts:92-106`, `src/lib/xero-operation-outbox.ts:1004-1023`
- **Money / sync risk**: When `requiresAdditionalStripePayment` and an `additionalPaymentIntentId` is present, the supplementary invoice operation is enqueued in `WAITING_PAYMENT` status. It is only `released` to PENDING by the webhook (`webhooks/stripe/route.ts:486-491,525-530`) or `confirm-modification-payment/route.ts:87-92,120-125`. If the member abandons payment AND the webhook never delivers (e.g. signature secret rotation), the WAITING_PAYMENT op stays forever and the Xero ledger never reflects the planned supplementary charge. There is no timeout/expiry on WAITING_PAYMENT.
- **Trigger**: Abandoned supplementary payment + webhook outage.
- **Suggested fix**: Add a reaper that marks WAITING_PAYMENT operations as `CANCELLED` (or moves to FAILED with an admin alert) when the linked PaymentTransaction is FAILED or older than N days.
- **Commit**: `92d1125`
- **Acceptance**: Test that explicitly aged-out WAITING_PAYMENT operations are flagged.

### [MEDIUM] `failPaymentRecoveryOperation` admin alert only fires once even if the row is manually retried

- **Location**: `src/lib/payment-recovery.ts:202-229`
- **Money / sync risk**: After max attempts, the row is marked FAILED with `nextRetryAt = null` and an alert fires. An admin who manually edits `nextRetryAt` to retry (no UI for this exists, but the DB is reachable) and the op fails again will not re-alert because the worker only enters this path on `attempts >= MAX` and the alert is fire-and-forget without dedup tracking. Cosmetic in current state because manual retry tooling doesn't exist yet.
- **Trigger**: Future admin tooling that allows manual retry.
- **Suggested fix**: Track `alertSentAt` on the row, or accept current behaviour and document.
- **Commit**: `228f24e`
- **Acceptance**: N/A until manual retry UI exists.

### [LOW] `cancelPaymentIntentIfCancellableWithResult` does not handle `requires_action` returning an unexpected status

- **Location**: `src/lib/stripe.ts:209-231`
- **Money / sync risk**: The set includes `requires_action`, but if Stripe is mid-state during cancellation it may return an intent that immediately transitions to `succeeded`. The function returns `canceled: true` based on the API call result. The caller `processCancelPaymentIntentOperation` correctly handles the `succeeded` re-check (line 376 in `payment-recovery.ts`), but only when `canceled` is false. The current branching at line 370-374 treats a successful cancel API response as the terminal canceled state and proceeds to mark the transaction failed - if Stripe actually captured first, we'd be miscategorising. In practice Stripe will throw on this, but it's worth a defensive check on the returned `paymentIntent.status`.
- **Suggested fix**: Re-check `result.paymentIntent.status` after the cancel call; if it's `succeeded`, route to the refund handoff regardless of `canceled`.
- **Commit**: `228f24e`
- **Acceptance**: Mock Stripe to return `succeeded` after a cancel call.

### [LOW] Webhook handler does not listen for `payment_intent.requires_action` or `payment_intent.processing`

- **Location**: `src/app/api/webhooks/stripe/route.ts:102-146`
- **Money / sync risk**: For 3DS-required payments, `requires_action` may sit for hours. Not having an event listener means our local `PaymentTransaction.status` lags. Not a correctness bug; the `confirm-modification-payment` route handles the catch-up. Worth noting only for observability.
- **Suggested fix**: Optional - log/track `processing` events for observability.
- **Commit**: n/a, pre-existing
- **Acceptance**: Optional dashboard improvement.

### [LOW] Xero credit note URL is hard-coded `null`

- **Location**: `src/lib/membership-cancellation-xero.ts:389`, repeated at line 434
- **Money / sync risk**: `xeroObjectUrl` is set to `null` for credit notes even though `buildXeroInvoiceUrl` is imported. Reconciliation links in the admin UI will show no link to the Xero credit note.
- **Suggested fix**: Add `buildXeroCreditNoteUrl` or use the appropriate helper; current state is a UX miss, no money risk.
- **Commit**: `8c0a9ec`
- **Acceptance**: Snapshot the admin reconciliation list and confirm URLs exist.

## Test coverage gaps

- `membership-cancellation-xero.test.ts` does not assert behaviour for PAID subscriptions (no Stripe refund, no Xero side-effect) - this is the highest-risk untested path.
- `payment-recovery.test.ts` does not cover the timeout/stale-PROCESSING path with `attempts >= MAX` (related to medium finding above).
- `payment-recovery.test.ts` does not cover the "DB fails between Stripe refund and transaction status update" double-refund risk.
- `batch-modify-payment.test.ts` has the zero-dollar promo-to-zero test (`523`) and the immediate-recovery-failure test (`656`), but does not cover the case where `enqueuePaymentIntentCancellationRecovery` itself throws inside the transaction.
- `stripe-webhook-alerts.test.ts` covers `queueSupersededPaymentIntentRefundRecovery` and `completeCanceledSupersededPaymentIntentRecovery`, but does not assert that the `charge.refunded` handler interacts correctly with a recovery-driven refund (no double-credit-note in Xero).
- `xero-booking-edit-settlement.test.ts` has 4 unit tests covering the classifier but no integration coverage for the `queueXeroBookingEditSettlement` happy path (the function with side effects).
- No test covers the `WAITING_PAYMENT` Xero operation being released by the webhook OR by `confirm-modification-payment`.
- No test covers the modify-dates route abandoning a prior `additionalPaymentIntentId` when a second modification happens.

## State machine sanity

- **Payment recovery (`PaymentRecoveryOperation`)**: PENDING -> PROCESSING (atomic via `updateMany`, line 233-251) -> SUCCEEDED | FAILED (with nextRetryAt) -> back to claimable until `attempts >= MAX`. Idempotent via deterministic idempotency keys built from `paymentTransactionId + paymentIntentId`. Recoverable. The state machine is sound except for the stale-PROCESSING-on-max-attempts gap noted in findings.
- **Booking edit settlement (Xero outbox)**: Decision -> enqueue (CREATE for supplementary/credit-note/primary-invoice, UPDATE for narration) -> PENDING (or WAITING_PAYMENT for the supplementary-with-stripe-wait case) -> RUNNING -> SUCCEEDED. Replay-safe via Xero idempotency keys built from `BookingModification.id`. Ordering is correct: Stripe is settled first (refund or additional intent created), then `void queueXeroBookingEditSettlement(...)` is fired - Xero work is queued, not blocking, and the `WAITING_PAYMENT` gate prevents premature Xero charge recording. The only gap is the missing reaper for WAITING_PAYMENT (medium finding above).
- **Membership cancellation**: REQUESTED -> CONFIRMED -> approved -> CANCELLED (participant); request lifecycle is REQUESTED -> COMPLETED|REJECTED. Local DB update is atomic in the `$transaction`. Xero side is queued post-transaction (`xero-operation-outbox` queue with PENDING -> RUNNING -> SUCCEEDED, deduplicated via `buildXeroIdempotencyKey`). Recoverable for the Xero leg via the outbox retry loop. NOT recoverable / not even attempted for the Stripe refund - this is the critical finding above.

## Confirmed-good

- `ProcessedWebhookEvent` claim uses the canonical P2002 collision pattern at `src/app/api/webhooks/stripe/route.ts:84-100`, with a cleanup `deleteMany` on handler failure so retries can re-process. Correct.
- The idempotency key construction in `payment-recovery.ts:44-56` is deterministic and unique per logical operation (`paymentTransactionId + paymentIntentId` + operation type), so retries do not double-charge.
- The atomic claim at `payment-recovery.ts:231-260` uses `updateMany` with a filter on status + attempts + nextRetryAt, then checks `count !== 1`. Two workers cannot claim the same row.
- The Stripe webhook handler at `payment_intent.succeeded` correctly checks for superseded intents BEFORE confirming the booking (`webhooks/stripe/route.ts:210-222`), preventing a "supersede + succeed" race from re-confirming a zero-dollar booking.
- The `handleCancelledBookingPaymentSucceeded` path (`webhooks/stripe/route.ts:735-829`) is a good defensive design: if a payment somehow captures after the booking is cancelled, an automatic refund is issued, an alert is sent, and a Xero credit note is queued.
- The `WAITING_PAYMENT` -> `PENDING` transition in `releaseXeroSupplementaryInvoiceOperationsForPaymentIntent` (`xero-operation-outbox.ts:1029-1073`) is atomic via `updateMany` with a status guard, so a webhook + confirm-route race cannot release twice.
- The `confirm-modification-payment` route (`confirm-modification-payment/route.ts:82-94`) is correctly idempotent: if the transaction status is already SUCCEEDED/REFUNDED, it short-circuits and re-runs the Xero release in case the webhook arrived first but the user navigated to the confirm route afterward.
- The `xero-booking-edit-settlement.classifyXeroBookingEditSettlement` classifier (pure function) is well-tested and produces a clear decision object that separates financial action from primary-invoice update action, making the policy auditable.
- The `cancelPaymentIntentIfCancellableWithResult` extraction (`stripe.ts:209-231`) and the recovery handler's check for `succeeded` status returning from cancel (`payment-recovery.ts:376-386`) correctly handles the race where Stripe captures before we cancel.
- Webhook signature verification is enforced before any state changes (`webhooks/stripe/route.ts:48-77`).
- Amount mismatch is detected and alerts admins rather than silently auto-applying (`webhooks/stripe/route.ts:259-277` and `496-514`).
