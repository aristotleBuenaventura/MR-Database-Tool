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

/** Min time between password-reset emails for the same account. */
export const PASSWORD_RESET_COOLDOWN_MS = (() => {
  const raw = process.env.PASSWORD_RESET_COOLDOWN_MS;
  const n = raw === undefined || raw.trim() === "" ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 2 * 60 * 1000;
})();

/** Max forgot-password requests per IP in the login rate window. */
export const FORGOT_PASSWORD_RATE_MAX = (() => {
  const raw = process.env.FORGOT_PASSWORD_RATE_MAX;
  const n = raw === undefined || raw.trim() === "" ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 5;
})();


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

/**
 * Trust X-Forwarded-For only when the API sits behind a reverse proxy.
 * Leave unset when clients can reach the API port directly, or a caller can
 * invent an IP and skip the login rate limit.
 */
export function trustProxyEnabled(): boolean {
  const value = (process.env.TRUST_PROXY ?? "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
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
