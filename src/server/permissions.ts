import type { Role } from "@prisma/client";
import type { PermissionFlag, PermissionMap } from "../shared/types";
import { defaultPermissionsByRole } from "../shared/types";

export function parsePermissions(role: Role, permissionsJson: string): PermissionMap {
  const defaults = defaultPermissionsByRole[role];
  try {
    const custom = JSON.parse(permissionsJson) as Partial<PermissionMap>;
    return { ...defaults, ...custom };
  } catch {
    return defaults;
  }
}

export function hasPermission(
  role: Role,
  permissionsJson: string,
  permission: PermissionFlag
): boolean {
  if (role === "OWNER") {
    return true;
  }
  return parsePermissions(role, permissionsJson)[permission] === true;
}
