# Track 1 - Consistency review

## Summary
- Files reviewed: 196 changed (focused on ~40 new lib/route/page files)
- Findings: 0 critical, 1 high, 4 medium, 4 low
- No-action items: 3 (with rationale)

## Findings

### [HIGH] Booking change request alert uses wrong admin preference key
- **Location**: `src/lib/email.ts:1675`
- **Pattern broken**: NotificationDeliveryPolicy / admin notification preference wiring
- **Problem**: `sendAdminBookingChangeRequestAlert` passes `preferenceKey: "adminFamilyGroupRequest"` to `sendToAdmins`. Booking change requests have nothing to do with family group requests. Admins who turn off family-group alerts will silently stop receiving booking change request alerts, and the new feature has no dedicated opt-out. There is no `adminBookingChangeRequest` key in `ADMIN_NOTIFICATION_PREFERENCE_META` (`src/lib/admin-notification-preferences.ts:1-47`).
- **Suggested fix**: Add a new `adminBookingChangeRequest` key to `ADMIN_NOTIFICATION_PREFERENCE_META`, the `_SELECT` and `resolveAdminNotificationPreferences` blocks, the Prisma `NotificationPreference` model (with default `true`), a migration backfilling existing rows, and switch line 1675 to `preferenceKey: "adminBookingChangeRequest"`. Update the per-admin toggle UI.
- **Commit**: `6d9ba04` Add booking change request queue
- **Acceptance**: Toggling the new "Booking change requests" toggle on `/admin/notifications` independently controls receipt of the alert; existing admins still receive it by default.

### [MEDIUM] Admin booking change request routes diverge from email-settings auth pattern
- **Location**: `src/app/api/admin/booking-change-requests/route.ts:13-19` and `src/app/api/admin/booking-change-requests/[id]/route.ts:49-54,73-78`
- **Pattern broken**: Admin API auth gate (golden pattern #2)
- **Problem**: New route collapses 401-vs-403 into a single `401 "Unauthorised"` response when role is wrong, instead of the `requireAdmin` helper used in `src/app/api/admin/email-settings/route.ts:40-59`, `membership-cancellation-settings/route.ts:43-62`, and `notification-delivery-policies/route.ts:27-44` (no-session -> 401, wrong-role -> 403). Status code conflation makes client retry/redirect logic brittle, and the new route is the only one in this batch that diverges from the shared helper.
- **Suggested fix**: Extract a shared `requireAdmin()` helper into `src/lib/session-guards.ts` (or copy the local pattern) and return 401 vs 403 separately. Apply across both new files.
- **Commit**: `6d9ba04` Add booking change request queue
- **Acceptance**: Both routes return 401 for missing session, 403 for non-admin members, 200 only for admins (covered by integration test).

### [MEDIUM] BookingChangeRequest status terminology diverges from sibling review queues
- **Location**: `prisma/schema.prisma:172-176`
- **Pattern broken**: Prisma schema conventions (golden pattern #4)
- **Problem**: New enum uses `PENDING / RESOLVED / DECLINED`. The two sibling review queues introduced in the same 48 h window — `MembershipCancellationRequestStatus` (`schema.prisma:119`) and `MemberLifecycleActionRequestStatus` (`schema.prisma:142`) — both use `REQUESTED / APPROVED / REJECTED`. Mixed vocabulary makes cross-feature dashboards, filters, and audit logs harder to reason about.
- **Suggested fix**: Either rename to `REQUESTED / APPROVED / REJECTED` (preferred — matches the other two queues and the admin sidebar badge term "Pending"), or document why the booking-edit queue uses "Resolved" instead of "Approved" in `docs/ARCHITECTURE.md`.
- **Commit**: `6d9ba04` Add booking change request queue
- **Acceptance**: Either enum values are aligned across the three queues, or the deliberate divergence is documented.

### [MEDIUM] BookingChangeRequest FK columns use a different naming convention
- **Location**: `prisma/schema.prisma:1493-1506`
- **Pattern broken**: Prisma schema conventions (golden pattern #4)
- **Problem**: Uses `requesterId` / `reviewedById` whereas the other request-style models introduced this window — `MembershipCancellationRequest` (`schema.prisma:460-465`) and `MemberLifecycleActionRequest` (`schema.prisma:520-522`) — use `requestedByMemberId` / `reviewedByMemberId`. The repo already has both spellings in older models, so this is not a clear bug, but two contemporaneous features should align.
- **Suggested fix**: Rename to `requestedByMemberId` / `reviewedByMemberId` in a follow-up migration, or adopt `requesterId` / `reviewedById` for the new MembershipCancellation/MemberLifecycle models. Pick one before more queues land.
- **Commit**: `6d9ba04` Add booking change request queue
- **Acceptance**: All three request-style models share one column-naming convention.

### [MEDIUM] BookingChangeRequest.bookingId uses ON DELETE RESTRICT
- **Location**: `prisma/migrations/20260524220000_add_booking_change_requests/migration.sql:33-35`, `prisma/schema.prisma:1504`
- **Pattern broken**: Prisma FK on-delete behaviour (golden pattern #4)
- **Problem**: Other booking-linked review tables in the diff use `SetNull` for actor columns; `bookingId` here uses `Restrict`, meaning bookings with any historical change request can never be hard-deleted, even after the request is resolved. This is asymmetric with `Booking -> Payment` and may collide with the new member-delete lifecycle (which expects member/booking purge).
- **Suggested fix**: Either keep `Restrict` (and document why bookings with historical change requests cannot be purged) or switch to `Cascade` / `SetNull`. Add a test covering the member-delete-with-historical-change-request scenario before resolving.
- **Commit**: `6d9ba04` Add booking change request queue
- **Acceptance**: Test for member-delete lifecycle confirms expected behaviour against a booking that has a resolved change request.

### [LOW] Public membership-cancellation page bypasses NZ date helper
- **Location**: `src/app/(public)/membership-cancellation/[token]/page.tsx:30-36`, `src/app/(authenticated)/profile/membership-cancellation-panel.tsx:79-86`, `src/app/(admin)/admin/booking-change-requests/page.tsx:82-95`, `src/app/(admin)/admin/membership-cancellations/page.tsx:108-114`
- **Pattern broken**: NZ dates via timezone helpers (golden pattern #5)
- **Problem**: Four new pages each define their own `formatDate` using `new Date(value).toLocaleDateString("en-NZ", …)` instead of importing `formatNZDate` from `src/lib/nzst-date.ts`. They all happen to produce sensible output today, but they bypass the central timezone helper and will drift if NZ formatting rules change.
- **Suggested fix**: Replace each inline helper with `formatNZDate` (or expose a shared client-safe variant if needed).
- **Commit**: `74ad857`, `6d9ba04`, `7acb4de`
- **Acceptance**: `grep -rn 'toLocaleDateString("en-NZ"' src/app` returns zero new matches.

### [LOW] BookingChangeRequest admin route uses British "Unauthorised" while sibling new routes use "Unauthorized"
- **Location**: `src/app/api/admin/booking-change-requests/route.ts:16`, `src/app/api/admin/booking-change-requests/[id]/route.ts:51,75`
- **Pattern broken**: Error envelope copy (golden pattern #6)
- **Problem**: Both spellings exist in the codebase pre-existing, but every other admin route added in this window uses "Unauthorized" (US spelling, matching JSON convention in the rest of `src/app/api/admin/*`). For new code, pick one. Per NZ English the repo could converge on "Unauthorised", but the in-window convention is "Unauthorized".
- **Suggested fix**: Decide on one spelling and align all admin routes in a follow-up sweep. Either is acceptable as long as it's consistent.
- **Commit**: `6d9ba04`
- **Acceptance**: One spelling across `src/app/api/admin/**/route.ts`.

### [LOW] Duplicated participant-status label maps
- **Location**: `src/app/(public)/membership-cancellation/[token]/page.tsx:9-35` vs `src/app/(authenticated)/profile/membership-cancellation-panel.tsx:16-35`
- **Pattern broken**: DRY / shared UI labels
- **Problem**: The two pages each define identical `participantStatusLabel` and `requestStatusLabel` helpers covering the same 7 / 5 statuses. Any new status (e.g. `WITHDRAWN`) needs editing in both places. Same applies to the admin cancellations page (`membership-cancellations/page.tsx`).
- **Suggested fix**: Lift the label maps into `src/lib/membership-cancellation-status-labels.ts` and import wherever needed.
- **Commit**: `74ad857`, `7acb4de`
- **Acceptance**: A single source of truth for the status-to-label map.

### [LOW] `MemberLifecycleActionRequest.memberId` is unindexed-FK and explicitly has no constraint
- **Location**: `prisma/schema.prisma:512-537`, `prisma/migrations/20260524190000_member_delete_lifecycle_actions/migration.sql`
- **Pattern broken**: FK on foreign keys (golden pattern #4)
- **Problem**: `memberId` is a string column with no FK constraint (intentional — comment in the archive migration says "intentionally no FK so approved delete request snapshots can outlive the deleted member row"). The reason is sound, but it is unusual enough that any future contributor reading the schema will assume an FK is missing.
- **Suggested fix**: Add an inline comment in `schema.prisma` (above line 514) explaining "no FK by design; deleted-member snapshots must survive Member purge". The migration already documents it; the schema doesn't.
- **Commit**: `e3ca9c5` Add safe member delete lifecycle
- **Acceptance**: `schema.prisma` reads self-explanatorily.

## Confirmed-good (no action)

These features were checked and follow the golden patterns:

- All 5 new email template names (`membership-cancellation-confirmation`, `membership-cancellation-approved`, `membership-cancellation-rejected`, `age-up-parent-email-handoff`, `admin-booking-change-request`) are correctly registered in `EMAIL_AUDIT_DEFAULTS` (`src/lib/email-message-audit-defaults.ts`) and auto-flow into `EMAIL_TEMPLATE_DEFINITIONS` via the registry's `Object.entries(EMAIL_AUDIT_DEFAULTS).map(...)` (`src/lib/email-message-registry.ts:210`). `admin-booking-change-request` is properly listed in `ADMIN_SYSTEM_TEMPLATE_NAMES` (`src/lib/email-message-registry.ts:24-42`).
- All new email-sending functions route through `sendEmail()` and respect `shouldSendAdminSystemEmail` via `sendToAdmins`.
- Confirmation tokens for membership cancellation are hashed (`hashActionToken`) before DB persistence — no plaintext tokens stored (`src/lib/membership-cancellation-requests.ts:505,524`).
- Money handled in cents end-to-end in new files (`src/lib/booking-edit-guest-ranges.ts`, `src/lib/xero-booking-edit-settlement.ts`, `src/lib/payment-recovery.ts`). The one `* 100` in `membership-cancellation-xero.ts:48` is converting a Xero-supplied dollar amount to cents — the standard idiom.
- New admin pages (`/admin/booking-change-requests`, `/admin/membership-cancellations`) are wired into `admin-sidebar.tsx` with pending-count badges.
- `MembershipCancellationSettingsPanel` is exposed on the `/admin/setup` page (line 492). `NotificationDeliveryPolicySettings` and `EmailMessageSettingsPanel` are exposed on `/admin/notifications` (lines 58, 85).
- New admin routes other than `booking-change-requests` (e.g. `email-settings`, `membership-cancellation-settings`, `notification-delivery-policies`, `members/[id]/lifecycle/*`, `member-lifecycle-action-requests/[requestId]`, `membership-cancellation-requests/*`) use the shared `requireAdmin`-style helper with proper 401/403 split and `requireActiveSessionUser` check.
- Membership cancellation settings PUT uses a Prisma `$transaction` for the multi-write upsert + Xero contact group sync (`src/app/api/admin/membership-cancellation-settings/route.ts:115-156`).
- Prisma schema follows camelCase fields, PascalCase models, with appropriate indices on FKs and unique business keys (e.g. `MembershipCancellationRequestParticipant_requestId_memberId_key`).
- `BookingChangeRequest` includes indices on `(bookingId, status, createdAt)`, `(requesterId, status, createdAt)`, `(status, createdAt)`, `(reviewedById, reviewedAt)` — adequate query coverage.
- `member-lifecycle-actions.ts` sends no emails directly; lifecycle actions are pure DB workflows with audit logs (`createAuditLog`) and an `archiveMembers` relation to preserve the link after member purge.
- `cron-payments` route uses `timingSafeEqual(CRON_SECRET)` (consistent with other cron routes).
- Booking-edit policy (`src/lib/booking-edit-policy.ts`) is intentionally hard-coded business lifecycle, not a tunable knob, so no admin panel is needed.

## Notes / no-action

- The booking-edit policy is treated as a non-configurable lifecycle rule, so the absence of a settings panel is correct.
- Member archive cadence — none implemented; archive is a manual admin-approved workflow per `member-lifecycle-actions.ts`. No settings panel required.
- "Unauthorised" / "Unauthorized" spelling inconsistency pre-dates this window (see `src/app/api/admin/family-groups/route.ts:21`); only flagged where introduced anew.
