-- The finance dashboard now reads from the single operational Xero connection
-- (the same one bookings, payments, and subscriptions use). The dedicated finance
-- Xero OAuth token store and its separate API usage metering tables are no longer
-- written or read, so drop them.
--
-- Deploy ordering: ship the application code that stops using these tables before
-- running this migration. FinanceSnapshot, FinanceSyncRun, the operational
-- XeroToken/XeroApiUsage* tables, and Member.financeAccessLevel are all retained.
DROP TABLE IF EXISTS "FinanceXeroApiUsageEvent";
DROP TABLE IF EXISTS "FinanceXeroApiUsageDaily";
DROP TABLE IF EXISTS "FinanceXeroToken";
