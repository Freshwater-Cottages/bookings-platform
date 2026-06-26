-- Add CHART_OF_ACCOUNTS to the FinanceSnapshotType enum so the finance sync can
-- cache the operational chart of accounts. The cached account-id-to-code map lets
-- revenue reconciliation match Xero profit-and-loss lines to GL codes without a
-- live Xero call.
ALTER TYPE "FinanceSnapshotType" ADD VALUE IF NOT EXISTS 'CHART_OF_ACCOUNTS';
