import type { Request } from "express";
import { prisma } from "./prisma.js";
import { clientIp, clientUserAgent } from "./sessions.js";

export async function auditSecurityEvent(input: {
  event: string;
  req?: Request;
  userId?: number | null;
  email?: string | null;
  detail?: string | null;
}) {
  try {
    await prisma.securityAuditLog.create({
      data: {
        event: input.event,
        userId: input.userId ?? null,
        email: input.email ?? null,
        ipAddress: input.req ? clientIp(input.req) : null,
        userAgent: input.req ? clientUserAgent(input.req) : null,
        detail: input.detail ?? null,
      },
    });
  } catch (error) {
    console.error("[security-audit]", error);
  }

  const ip = input.req ? clientIp(input.req) : null;
  console.info(
    `[security] ${input.event}` +
      (input.email ? ` email=${input.email}` : "") +
      (input.userId != null ? ` userId=${input.userId}` : "") +
      (ip ? ` ip=${ip}` : "") +
      (input.detail ? ` detail=${input.detail}` : ""),
  );
}
