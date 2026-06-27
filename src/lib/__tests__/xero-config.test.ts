import { afterEach, describe, expect, it } from "vitest";
import { getOperationalXeroConfig } from "@/lib/xero-config";

const originalEnv = { ...process.env };

function restoreEnv() {
  process.env = { ...originalEnv };
}

describe("xero-config", () => {
  afterEach(() => {
    restoreEnv();
  });

  it("keeps operational Xero config on the existing env names", () => {
    process.env.XERO_CLIENT_ID = "operational-client";
    process.env.XERO_CLIENT_SECRET = "operational-secret";
    process.env.XERO_REDIRECT_URI = "https://example.com/api/admin/xero/callback";

    expect(getOperationalXeroConfig()).toMatchObject({
      clientId: "operational-client",
      clientSecret: "operational-secret",
      redirectUris: ["https://example.com/api/admin/xero/callback"],
    });
  });

  it("includes the reports scope so finance reports can be synced through the single connection", () => {
    expect(getOperationalXeroConfig().scopes).toContain(
      "accounting.reports.read"
    );
  });
});
