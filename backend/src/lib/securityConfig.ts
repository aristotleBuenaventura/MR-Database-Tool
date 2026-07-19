/** Security-related configuration (env-driven). */

export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? "8h";
export const COOKIE_NAME = process.env.AUTH_COOKIE_NAME ?? "mr_session";

/** Idle session timeout — no API activity for this long ends the session. */
export const IDLE_TIMEOUT_MS = Number(
  process.env.SESSION_IDLE_TIMEOUT_MS ?? 30 * 60 * 1000,
);

export const MAX_FAILED_LOGINS = Number(process.env.MAX_FAILED_LOGINS ?? 5);
export const LOCKOUT_MINUTES = Number(process.env.LOCKOUT_MINUTES ?? 15);

export const LOGIN_RATE_WINDOW_MS = Number(
  process.env.LOGIN_RATE_WINDOW_MS ?? 15 * 60 * 1000,
);
export const LOGIN_RATE_MAX = Number(process.env.LOGIN_RATE_MAX ?? 20);

export function cookieSecure(): boolean {
  if (process.env.COOKIE_SECURE === "true") return true;
  if (process.env.COOKIE_SECURE === "false") return false;
  return process.env.NODE_ENV === "production";
}

export function cookieSameSite(): "lax" | "strict" | "none" {
  const value = (process.env.COOKIE_SAMESITE ?? "lax").toLowerCase();
  if (value === "strict" || value === "none" || value === "lax") return value;
  return "lax";
}

/** Comma-separated IPs. Empty = allow all. */
export function allowedIps(): string[] {
  return String(process.env.ALLOWED_IPS ?? "")
    .split(",")
    .map((ip) => ip.trim())
    .filter(Boolean);
}

export function rolesRequiring2fa(): Set<string> {
  const raw = process.env.REQUIRE_2FA_ROLES ?? "admin,superadmin";
  return new Set(
    raw
      .split(",")
      .map((r) => r.trim().toLowerCase())
      .filter(Boolean),
  );
}
