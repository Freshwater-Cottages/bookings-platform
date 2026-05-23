import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  requireActiveSessionUser: vi.fn(),
  emailTemplateOverrideFindUnique: vi.fn(),
  emailTemplateOverrideUpsert: vi.fn(),
  emailTemplateOverrideFindMany: vi.fn(),
  notificationDeliveryPolicyFindUnique: vi.fn(),
  notificationDeliveryPolicyUpsert: vi.fn(),
  notificationDeliveryPolicyFindMany: vi.fn(),
  auditLogCreate: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: mocks.auth,
}));

vi.mock("@/lib/session-guards", () => ({
  requireActiveSessionUser: mocks.requireActiveSessionUser,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    emailTemplateOverride: {
      findUnique: mocks.emailTemplateOverrideFindUnique,
      upsert: mocks.emailTemplateOverrideUpsert,
      findMany: mocks.emailTemplateOverrideFindMany,
    },
    notificationDeliveryPolicy: {
      findUnique: mocks.notificationDeliveryPolicyFindUnique,
      upsert: mocks.notificationDeliveryPolicyUpsert,
      findMany: mocks.notificationDeliveryPolicyFindMany,
    },
    auditLog: {
      create: mocks.auditLogCreate,
    },
  },
}));

import { PUT as putEmailTemplate } from "@/app/api/admin/email-templates/route";
import { PUT as putDeliveryPolicy } from "@/app/api/admin/notification-delivery-policies/route";

function request(path: string, body: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("admin email message APIs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
    mocks.requireActiveSessionUser.mockResolvedValue(null);
    mocks.emailTemplateOverrideFindUnique.mockResolvedValue(null);
    mocks.emailTemplateOverrideUpsert.mockResolvedValue({
      id: "override-1",
      templateName: "password-reset",
      subject: "Reset your password",
      bodyText: "Reset here {{BASE_URL}}/reset-password?token={{token}}",
      updatedByMemberId: "admin-1",
    });
    mocks.notificationDeliveryPolicyFindUnique.mockResolvedValue(null);
    mocks.notificationDeliveryPolicyUpsert.mockResolvedValue({
      id: "policy-1",
      templateName: "admin-daily-digest",
      mode: "DISABLED",
      updatedByMemberId: "admin-1",
    });
    mocks.auditLogCreate.mockResolvedValue({});
  });

  it("blocks non-admin users", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "member-1", role: "MEMBER" } });

    const response = await putEmailTemplate(
      request("/api/admin/email-templates", {
        templateName: "password-reset",
        subject: "Reset your password",
        bodyText: "Reset here {{BASE_URL}}/reset-password?token={{token}}",
      }),
    );

    expect(response.status).toBe(403);
    expect(mocks.emailTemplateOverrideUpsert).not.toHaveBeenCalled();
  });

  it("honors inactive-user blocking", async () => {
    mocks.requireActiveSessionUser.mockResolvedValue(
      new Response(JSON.stringify({ error: "Inactive user" }), { status: 403 }),
    );

    const response = await putEmailTemplate(
      request("/api/admin/email-templates", {
        templateName: "password-reset",
        subject: "Reset your password",
        bodyText: "Reset here {{BASE_URL}}/reset-password?token={{token}}",
      }),
    );

    expect(response.status).toBe(403);
    expect(mocks.emailTemplateOverrideUpsert).not.toHaveBeenCalled();
  });

  it("rejects unsafe email template edits", async () => {
    const response = await putEmailTemplate(
      request("/api/admin/email-templates", {
        templateName: "password-reset",
        subject: "Reset\npassword",
        bodyText: "<strong>Reset</strong> javascript:alert(1)",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Invalid email template");
    expect(body.missingRequiredTokens).toContain("token");
    expect(body.unsafeLinks).toContain("javascript:alert(1)");
    expect(mocks.emailTemplateOverrideUpsert).not.toHaveBeenCalled();
  });

  it("saves valid template edits and audit logs the change", async () => {
    const response = await putEmailTemplate(
      request("/api/admin/email-templates", {
        templateName: "password-reset",
        subject: "Reset your password",
        bodyText: "Reset here {{BASE_URL}}/reset-password?token={{token}}",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.emailTemplateOverrideUpsert).toHaveBeenCalledWith({
      where: { templateName: "password-reset" },
      create: expect.objectContaining({
        templateName: "password-reset",
        updatedByMemberId: "admin-1",
      }),
      update: expect.objectContaining({
        updatedByMemberId: "admin-1",
      }),
    });
    expect(mocks.auditLogCreate).toHaveBeenCalled();
  });

  it("updates editable delivery policies and blocks locked system policies", async () => {
    const lockedResponse = await putDeliveryPolicy(
      request("/api/admin/notification-delivery-policies", {
        templateName: "admin-email-failure",
        mode: "disabled",
      }),
    );

    expect(lockedResponse.status).toBe(400);

    const response = await putDeliveryPolicy(
      request("/api/admin/notification-delivery-policies", {
        templateName: "admin-daily-digest",
        mode: "disabled",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.notificationDeliveryPolicyUpsert).toHaveBeenCalledWith({
      where: { templateName: "admin-daily-digest" },
      create: expect.objectContaining({
        templateName: "admin-daily-digest",
        mode: "DISABLED",
        updatedByMemberId: "admin-1",
      }),
      update: expect.objectContaining({
        mode: "DISABLED",
        updatedByMemberId: "admin-1",
      }),
    });
    expect(mocks.auditLogCreate).toHaveBeenCalled();
  });
});
