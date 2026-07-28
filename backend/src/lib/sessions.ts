import { randomUUID } from "node:crypto";
import type { Request } from "express";
import { prisma } from "./prisma.js";

/** A session is "online" if last seen within this window. */
export const ONLINE_WINDOW_MS = 2 * 60 * 1000;

export function clientIp(req: Request): string | null {
  const forwarded = req.headers["x-forwarded-for"];
  let ip: string | null = null;
  if (typeof forwarded === "string" && forwarded.trim()) {
    ip = forwarded.split(",")[0]?.trim() || null;
  } else {
    ip = req.ip ?? null;
  }
  // user_sessions.ip_address is VARCHAR(64)
  return ip ? ip.slice(0, 64) : null;
}

export function clientUserAgent(req: Request): string | null {
  const ua = req.headers["user-agent"];
  if (!ua) return null;
  return ua.slice(0, 512);
}

export async function createSession(userId: number, req: Request) {
  const id = randomUUID();
  const session = await prisma.userSession.create({
    data: {
      id,
      userId,
      ipAddress: clientIp(req),
      userAgent: clientUserAgent(req),
    },
  });
  return session;
}

export async function touchSession(sessionId: string) {
  await prisma.userSession.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { lastSeenAt: new Date() },
  });
}

export async function revokeSession(sessionId: string) {
  await prisma.userSession.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeUserSessions(userId: number) {
  const result = await prisma.userSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

export async function findActiveSession(sessionId: string) {
  return prisma.userSession.findFirst({
    where: { id: sessionId, revokedAt: null },
  });
}

export function isOnline(lastSeenAt: Date, now = new Date()): boolean {
  return now.getTime() - lastSeenAt.getTime() <= ONLINE_WINDOW_MS;
}
