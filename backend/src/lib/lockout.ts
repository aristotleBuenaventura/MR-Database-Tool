import { prisma } from "./prisma.js";
import { LOCKOUT_MINUTES, MAX_FAILED_LOGINS } from "./securityConfig.js";

/** Count a bad password or authenticator code. Locks the account at the limit. */
export async function recordFailedSignIn(user: {
  id: number;
  failedLoginAttempts: number;
}): Promise<{ lockedUntil: Date | null; attempts: number }> {
  const attempts = user.failedLoginAttempts + 1;
  const lockedUntil =
    attempts >= MAX_FAILED_LOGINS
      ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000)
      : null;

  await prisma.user.update({
    where: { id: user.id },
    data: {
      failedLoginAttempts: lockedUntil ? 0 : attempts,
      lockedUntil,
    },
  });

  return { lockedUntil, attempts };
}
