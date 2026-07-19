import { createHash, randomBytes } from "node:crypto";
import { prisma } from "./prisma.js";
import { PASSWORD_RESET_COOLDOWN_MS } from "./securityConfig.js";

export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

export function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateResetToken(): string {
  return randomBytes(32).toString("hex");
}

export function appPublicUrl(): string {
  return (
    process.env.APP_URL?.trim() ||
    process.env.CORS_ORIGIN?.trim() ||
    "http://localhost:5173"
  ).replace(/\/$/, "");
}

export function buildResetUrl(token: string): string {
  return `${appPublicUrl()}/reset-password?token=${encodeURIComponent(token)}`;
}

export function resetCooldownSeconds(): number {
  return Math.ceil(PASSWORD_RESET_COOLDOWN_MS / 1000);
}

/** In-memory cooldown by email (survives page refresh; resets on server restart). */
const emailCooldownUntil = new Map<string, number>();

export function memoryCooldownRemaining(email: string): number {
  const until = emailCooldownUntil.get(email) ?? 0;
  return Math.max(0, until - Date.now());
}

export function markEmailCooldown(email: string): void {
  emailCooldownUntil.set(email, Date.now() + PASSWORD_RESET_COOLDOWN_MS);
  // Opportunistic cleanup of expired entries
  const now = Date.now();
  for (const [key, until] of emailCooldownUntil) {
    if (until <= now) emailCooldownUntil.delete(key);
  }
}

/** Returns ms remaining until another reset email is allowed, or 0 if allowed. */
export async function passwordResetCooldownRemaining(
  userId: number,
): Promise<number> {
  const recent = await prisma.passwordResetToken.findFirst({
    where: {
      userId,
      createdAt: { gt: new Date(Date.now() - PASSWORD_RESET_COOLDOWN_MS) },
    },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });

  if (!recent) return 0;

  const elapsed = Date.now() - recent.createdAt.getTime();
  return Math.max(0, PASSWORD_RESET_COOLDOWN_MS - elapsed);
}

export async function forgotPasswordCooldownRemaining(
  email: string,
  userId?: number,
): Promise<number> {
  const mem = memoryCooldownRemaining(email);
  const db = userId ? await passwordResetCooldownRemaining(userId) : 0;
  return Math.max(mem, db);
}


/** Create a fresh reset token for the user; invalidates unused prior tokens. */
export async function createPasswordResetToken(userId: number): Promise<{
  token: string;
  expiresAt: Date;
}> {
  const token = generateResetToken();
  const tokenHash = hashResetToken(token);
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

  await prisma.passwordResetToken.updateMany({
    where: { userId, usedAt: null },
    data: { usedAt: new Date() },
  });

  await prisma.passwordResetToken.create({
    data: { userId, tokenHash, expiresAt },
  });

  return { token, expiresAt };
}

export async function consumePasswordResetToken(token: string) {
  const tokenHash = hashResetToken(token);
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!record || record.usedAt) {
    return null;
  }

  if (record.expiresAt.getTime() <= Date.now()) {
    return null;
  }

  await prisma.passwordResetToken.update({
    where: { id: record.id },
    data: { usedAt: new Date() },
  });

  return record.user;
}
