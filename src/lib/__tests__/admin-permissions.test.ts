import { describe, expect, it } from "vitest";
import {
  canViewAdminHref,
  canViewAdminHrefWithMatrix,
  financeAccessLevelFromMatrix,
  getAdminPermissionLevel,
  getAdminPermissionMatrix,
  getAdminRouteRequirement,
  hasAdminAreaAccess,
  hasAdminPortalAccess,
  hasFinanceManagerAccess,
  hasFinanceViewerAccess,
} from "@/lib/admin-permissions";

const LODGE_ONLY_DEFINITION = {
  overviewLevel: "NONE",
  bookingsLevel: "NONE",
  membershipLevel: "NONE",
  financeLevel: "NONE",
  lodgeLevel: "EDIT",
  contentLevel: "NONE",
  supportLevel: "NONE",
} as const;

describe("admin permission bundles", () => {
  it("gives full admins edit access everywhere", () => {
    const matrix = getAdminPermissionMatrix({
      accessRoles: [{ role: "ADMIN" }],
      canLogin: true,
    });

    expect(Object.values(matrix).every((level) => level === "edit")).toBe(true);
    expect(hasAdminPortalAccess({ accessRoles: ["ADMIN"] })).toBe(true);
  });

  it("keeps read-only admin users at view access", () => {
    expect(
      getAdminPermissionLevel({ accessRoles: ["ADMIN_READONLY"] }, "bookings"),
    ).toBe("view");
    expect(
      hasAdminAreaAccess(
        { accessRoles: ["ADMIN_READONLY"] },
        { area: "bookings", level: "edit" },
      ),
    ).toBe(false);
  });

  it("merges bundled roles into a custom composed permission set", () => {
    const subject = {
      accessRoles: ["ADMIN_MEMBERSHIP", "ADMIN_CONTENT"],
      canLogin: true,
    };

    expect(getAdminPermissionLevel(subject, "membership")).toBe("edit");
    expect(getAdminPermissionLevel(subject, "content")).toBe("edit");
    expect(getAdminPermissionLevel(subject, "bookings")).toBe("view");
    expect(getAdminPermissionLevel(subject, "finance")).toBe("view");
  });

  it("keeps finance viewers out of the admin portal while allowing treasurers", () => {
    expect(hasAdminPortalAccess({ accessRoles: ["FINANCE_USER"] })).toBe(false);
    expect(hasAdminPortalAccess({ accessRoles: ["FINANCE_ADMIN"] })).toBe(true);
    expect(
      hasAdminAreaAccess(
        { accessRoles: ["FINANCE_ADMIN"] },
        { area: "finance", level: "edit" },
      ),
    ).toBe(true);
  });
});

describe("admin route requirements", () => {
  it("maps admin pages to view-level area access", () => {
    expect(getAdminRouteRequirement("/admin/members/123", "GET")).toEqual({
      area: "membership",
      level: "view",
    });
    expect(
      canViewAdminHref({ accessRoles: ["ADMIN_CONTENT"] }, "/admin/page-content"),
    ).toBe(true);
    expect(
      canViewAdminHref({ accessRoles: ["ADMIN_CONTENT"] }, "/admin/members"),
    ).toBe(false);
  });

  it("maps mutating admin API methods to edit access", () => {
    expect(getAdminRouteRequirement("/api/admin/page-content", "POST")).toEqual({
      area: "content",
      level: "edit",
    });
    expect(
      getAdminRouteRequirement("/api/admin/members/member-1/xero-link", "POST"),
    ).toEqual({
      area: "finance",
      level: "edit",
    });
  });

  it("keeps real admin APIs in their intended areas instead of overview fallback", () => {
    expect(
      getAdminRouteRequirement(
        "/api/admin/membership-cancellation-requests",
        "GET",
      ),
    ).toEqual({
      area: "membership",
      level: "view",
    });
    expect(
      getAdminRouteRequirement("/api/admin/induction-templates", "POST"),
    ).toEqual({
      area: "membership",
      level: "edit",
    });
    expect(
      getAdminRouteRequirement("/api/admin/email-failures/failure-1/review", "POST"),
    ).toEqual({
      area: "support",
      level: "edit",
    });
  });

  it("treats state-changing provider GET endpoints as edit access", () => {
    expect(getAdminRouteRequirement("/api/admin/xero/callback", "GET")).toEqual({
      area: "finance",
      level: "edit",
    });
  });
});

describe("definition-backed access roles", () => {
  it("prefers a joined definition over the legacy bundle for the same enum role", () => {
    // Club edited Booking Officer down to bookings: view.
    const matrix = getAdminPermissionMatrix({
      accessRoles: [
        {
          role: "ADMIN_BOOKINGS",
          roleDefinitionId: "ardef_admin_bookings",
          roleDefinition: {
            overviewLevel: "VIEW",
            bookingsLevel: "VIEW",
            membershipLevel: "NONE",
            financeLevel: "NONE",
            lodgeLevel: "NONE",
            contentLevel: "NONE",
            supportLevel: "NONE",
          },
        },
      ],
      canLogin: true,
    });
    expect(matrix.bookings).toBe("view");
    expect(matrix.lodge).toBe("none");
  });

  it("resolves custom definition-backed rows with no enum value", () => {
    const subject = {
      accessRoles: [
        {
          role: null,
          roleDefinitionId: "ardef_custom",
          roleDefinition: LODGE_ONLY_DEFINITION,
        },
      ],
      canLogin: true,
    };
    expect(getAdminPermissionLevel(subject, "lodge")).toBe("edit");
    expect(getAdminPermissionLevel(subject, "bookings")).toBe("none");
  });

  it("fails closed for custom rows selected without their definition", () => {
    const matrix = getAdminPermissionMatrix({
      accessRoles: [{ role: null, roleDefinitionId: "ardef_custom" }],
      canLogin: true,
    });
    expect(Object.values(matrix).every((level) => level === "none")).toBe(
      true,
    );
  });

  it("always resolves ADMIN from the hardcoded bundle, never a definition", () => {
    const matrix = getAdminPermissionMatrix({
      accessRoles: [
        {
          role: "ADMIN",
          roleDefinitionId: "ardef_rogue",
          roleDefinition: LODGE_ONLY_DEFINITION,
        },
      ],
      canLogin: true,
    });
    expect(Object.values(matrix).every((level) => level === "edit")).toBe(
      true,
    );
  });

  it("keeps the legacy bundle as fallback for bare enum rows", () => {
    expect(
      getAdminPermissionLevel({ accessRoles: ["ADMIN_BOOKINGS"] }, "bookings"),
    ).toBe("edit");
    expect(
      getAdminPermissionLevel({ accessRoles: ["FINANCE_USER"] }, "finance"),
    ).toBe("view");
  });

  it("supports matrix-based nav checks for client components", () => {
    const matrix = getAdminPermissionMatrix({
      accessRoles: ["ADMIN_CONTENT"],
      canLogin: true,
    });
    expect(canViewAdminHrefWithMatrix(matrix, "/admin/page-content")).toBe(
      true,
    );
    expect(canViewAdminHrefWithMatrix(matrix, "/admin/payments")).toBe(false);
  });
});

describe("matrix-derived finance access", () => {
  it("treats finance edit as manager and finance view as viewer", () => {
    expect(hasFinanceManagerAccess({ accessRoles: ["FINANCE_ADMIN"] })).toBe(
      true,
    );
    expect(hasFinanceViewerAccess({ accessRoles: ["FINANCE_USER"] })).toBe(
      true,
    );
    expect(hasFinanceManagerAccess({ accessRoles: ["FINANCE_USER"] })).toBe(
      false,
    );
    expect(hasFinanceViewerAccess({ accessRoles: ["USER"] })).toBe(false);
  });

  it("gives Full Admin manager access and scoped admins viewer access via their matrices", () => {
    // Intentional widening vs the legacy enum-keyed helpers.
    expect(hasFinanceManagerAccess({ accessRoles: ["ADMIN"] })).toBe(true);
    expect(hasFinanceViewerAccess({ accessRoles: ["ADMIN_READONLY"] })).toBe(
      true,
    );
    expect(hasFinanceViewerAccess({ accessRoles: ["ADMIN_BOOKINGS"] })).toBe(
      true,
    );
    expect(hasFinanceViewerAccess({ accessRoles: ["ADMIN_CONTENT"] })).toBe(
      false,
    );
  });

  it("derives finance access from custom definitions", () => {
    const financeViewRole = {
      accessRoles: [
        {
          role: null,
          roleDefinitionId: "ardef_custom_finance",
          roleDefinition: {
            ...LODGE_ONLY_DEFINITION,
            lodgeLevel: "NONE",
            financeLevel: "VIEW",
          },
        },
      ],
      canLogin: true,
    } as const;
    expect(hasFinanceViewerAccess(financeViewRole)).toBe(true);
    expect(hasFinanceManagerAccess(financeViewRole)).toBe(false);
  });

  it("maps matrices to the legacy financeAccessLevel compatibility values", () => {
    expect(
      financeAccessLevelFromMatrix(
        getAdminPermissionMatrix({ accessRoles: ["FINANCE_ADMIN"] }),
      ),
    ).toBe("MANAGER");
    expect(
      financeAccessLevelFromMatrix(
        getAdminPermissionMatrix({ accessRoles: ["ADMIN_MEMBERSHIP"] }),
      ),
    ).toBe("VIEWER");
    expect(
      financeAccessLevelFromMatrix(
        getAdminPermissionMatrix({ accessRoles: ["USER"] }),
      ),
    ).toBe("NONE");
  });
});
