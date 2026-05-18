-- Persist admin-level activation for optional modules.
-- Secrets and external credentials remain in their dedicated encrypted/env stores.
CREATE TABLE IF NOT EXISTS "ClubModuleSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "kiosk" BOOLEAN NOT NULL DEFAULT true,
    "chores" BOOLEAN NOT NULL DEFAULT true,
    "financeDashboard" BOOLEAN NOT NULL DEFAULT true,
    "waitlist" BOOLEAN NOT NULL DEFAULT true,
    "xeroIntegration" BOOLEAN NOT NULL DEFAULT true,
    "updatedByMemberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClubModuleSettings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ClubModuleSettings_updatedByMemberId_idx" ON "ClubModuleSettings"("updatedByMemberId");

INSERT INTO "ClubModuleSettings" ("id")
VALUES ('default')
ON CONFLICT ("id") DO NOTHING;
