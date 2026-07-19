export const ROLES = {
  VIEWER: "viewer",
  ADMIN: "admin",
  SUPERADMIN: "superadmin",
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

/** Roles that can be created from the Admin Dashboard. */
export const MANAGEABLE_ROLES = [ROLES.VIEWER, ROLES.ADMIN] as const;
export type ManageableRole = (typeof MANAGEABLE_ROLES)[number];

export function isRole(value: string): value is Role {
  return (
    value === ROLES.VIEWER ||
    value === ROLES.ADMIN ||
    value === ROLES.SUPERADMIN
  );
}

export function isManageableRole(value: string): value is ManageableRole {
  return value === ROLES.VIEWER || value === ROLES.ADMIN;
}

export function isAdmin(role: string): boolean {
  return role === ROLES.ADMIN;
}

export function isSuperadmin(role: string): boolean {
  return role === ROLES.SUPERADMIN;
}

/** Viewer: read-only. Admin: full report access. Superadmin: account management only. */
export const PERMISSIONS = {
  viewRecords: [ROLES.VIEWER, ROLES.ADMIN],
  createRecords: [ROLES.ADMIN],
  updateRecords: [ROLES.ADMIN],
  deleteRecords: [ROLES.ADMIN],
  importExcel: [ROLES.ADMIN],
  exportExcel: [ROLES.ADMIN],
  manageUsers: [ROLES.SUPERADMIN],
} as const;

export type Permission = keyof typeof PERMISSIONS;

export function hasPermission(role: string, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly string[]).includes(role);
}

export function homePathForRole(role: string): string {
  return isSuperadmin(role) ? "/admin" : "/dashboard";
}
