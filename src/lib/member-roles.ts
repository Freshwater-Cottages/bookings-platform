import type { Role } from "@prisma/client";

export const ROLE_VALUES = [
  "MEMBER",
  "ADMIN",
  "LODGE",
  "ASSOCIATE",
  "LIFE",
] as const satisfies readonly Role[];

export type AppRole = (typeof ROLE_VALUES)[number];

export const MEMBER_LEVEL_ROLE_VALUES = [
  "MEMBER",
  "ASSOCIATE",
  "LIFE",
] as const satisfies readonly Role[];

export type MemberLevelRole = (typeof MEMBER_LEVEL_ROLE_VALUES)[number];

export const OPERATIONAL_ROLE_VALUES = [
  "ADMIN",
  "LODGE",
] as const satisfies readonly Role[];

export const MEMBER_IMPORT_ROLE_VALUES = [
  "MEMBER",
  "ADMIN",
  "ASSOCIATE",
  "LIFE",
] as const satisfies readonly Role[];

export const ROLE_LABELS: Record<AppRole, string> = {
  MEMBER: "Member",
  ADMIN: "Admin",
  LODGE: "Lodge",
  ASSOCIATE: "Associate Member",
  LIFE: "Life Member",
};

export function isRole(value: string | null | undefined): value is AppRole {
  return ROLE_VALUES.includes(value as AppRole);
}

export function isMemberLevelRole(
  role: string | null | undefined,
): role is MemberLevelRole {
  return MEMBER_LEVEL_ROLE_VALUES.includes(role as MemberLevelRole);
}

export function isOperationalRole(
  role: string | null | undefined,
): role is (typeof OPERATIONAL_ROLE_VALUES)[number] {
  return OPERATIONAL_ROLE_VALUES.includes(
    role as (typeof OPERATIONAL_ROLE_VALUES)[number],
  );
}
