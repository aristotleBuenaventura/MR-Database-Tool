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

/** Viewer: read-only. Admin: full report access. Superadmin: reports + account management. */
export const PERMISSIONS = {
  viewRecords: [ROLES.VIEWER, ROLES.ADMIN, ROLES.SUPERADMIN],
  createRecords: [ROLES.ADMIN, ROLES.SUPERADMIN],
  updateRecords: [ROLES.ADMIN, ROLES.SUPERADMIN],
  deleteRecords: [ROLES.ADMIN, ROLES.SUPERADMIN],
  importExcel: [ROLES.ADMIN, ROLES.SUPERADMIN],
  exportExcel: [ROLES.ADMIN, ROLES.SUPERADMIN],
  manageUsers: [ROLES.SUPERADMIN],
} as const;

export type Permission = keyof typeof PERMISSIONS;

export function hasPermission(role: string, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly string[]).includes(role);
}

export function homePathForRole(role: string): string {
  return isSuperadmin(role) ? "/admin" : "/dashboard";
}
