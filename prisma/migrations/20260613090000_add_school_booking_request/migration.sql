-- School group booking requests (issue #709).
-- Adds the SCHOOL variant to the booking request type and the school-specific
-- columns: the invoiced school name and the teacher contact snapshot used to
-- create non-login hut-leader members on approval.

-- AlterEnum
ALTER TYPE "BookingRequestType" ADD VALUE IF NOT EXISTS 'SCHOOL';

-- AlterTable
ALTER TABLE "BookingRequest" ADD COLUMN "schoolName" VARCHAR(200);
ALTER TABLE "BookingRequest" ADD COLUMN "teachers" JSONB;
