-- Persistent review queue for member booking edits that touch NZ today or past nights.
CREATE TYPE "BookingChangeRequestStatus" AS ENUM ('PENDING', 'RESOLVED', 'DECLINED');

CREATE TABLE "BookingChangeRequest" (
  "id" TEXT NOT NULL,
  "bookingId" TEXT NOT NULL,
  "requesterId" TEXT NOT NULL,
  "status" "BookingChangeRequestStatus" NOT NULL DEFAULT 'PENDING',
  "requestedChanges" JSONB NOT NULL,
  "reason" VARCHAR(2000),
  "adminNotes" VARCHAR(2000),
  "reviewedById" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "BookingChangeRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BookingChangeRequest_bookingId_status_createdAt_idx"
  ON "BookingChangeRequest"("bookingId", "status", "createdAt");

CREATE INDEX "BookingChangeRequest_requesterId_status_createdAt_idx"
  ON "BookingChangeRequest"("requesterId", "status", "createdAt");

CREATE INDEX "BookingChangeRequest_status_createdAt_idx"
  ON "BookingChangeRequest"("status", "createdAt");

CREATE INDEX "BookingChangeRequest_reviewedById_reviewedAt_idx"
  ON "BookingChangeRequest"("reviewedById", "reviewedAt");

ALTER TABLE "BookingChangeRequest"
  ADD CONSTRAINT "BookingChangeRequest_bookingId_fkey"
  FOREIGN KEY ("bookingId") REFERENCES "Booking"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BookingChangeRequest"
  ADD CONSTRAINT "BookingChangeRequest_requesterId_fkey"
  FOREIGN KEY ("requesterId") REFERENCES "Member"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BookingChangeRequest"
  ADD CONSTRAINT "BookingChangeRequest_reviewedById_fkey"
  FOREIGN KEY ("reviewedById") REFERENCES "Member"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
