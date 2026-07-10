export const ROLES = {
  VIEWER: "viewer",
  ADMIN: "admin",
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export function isRole(value: string): value is Role {
  return value === ROLES.VIEWER || value === ROLES.ADMIN;
}

export function isAdmin(role: string): boolean {
  return role === ROLES.ADMIN;
}

/** Viewer: read-only. Admin: full access including Excel import/export. */
export const PERMISSIONS = {
  viewRecords: [ROLES.VIEWER, ROLES.ADMIN],
  createRecords: [ROLES.ADMIN],
  updateRecords: [ROLES.ADMIN],
  deleteRecords: [ROLES.ADMIN],
  importExcel: [ROLES.ADMIN],
  exportExcel: [ROLES.ADMIN],
  manageUsers: [ROLES.ADMIN],
} as const;

export type Permission = keyof typeof PERMISSIONS;

export function hasPermission(role: string, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly string[]).includes(role);
}
