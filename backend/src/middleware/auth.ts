import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma.js";
import { readAuthToken } from "../lib/cookies.js";
import { IDLE_TIMEOUT_MS } from "../lib/securityConfig.js";
import {
  hasPermission,
  isAdmin,
  isSuperadmin,
  type Permission,
} from "../lib/roles.js";
import { findActiveSession, revokeSession, touchSession } from "../lib/sessions.js";
import { allowedIps } from "../lib/securityConfig.js";
import { clientIp } from "../lib/sessions.js";

export type AuthUser = {
  userId: number;
  email: string;
  role: string;
  sessionId: string;
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function ipAllowlist(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const allow = allowedIps();
  if (allow.length === 0) return next();

  const ip = clientIp(req) ?? "";
  const normalized = ip.replace(/^::ffff:/, "");
  if (allow.includes(ip) || allow.includes(normalized)) {
    return next();
  }

  return res.status(403).json({ error: "Access denied from this network." });
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = readAuthToken(req);
  if (!token) {
    return res.status(401).json({ error: "Missing or invalid token" });
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    return res.status(500).json({ error: "JWT_SECRET is not configured" });
  }

  void (async () => {
    try {
      const payload = jwt.verify(token, secret) as {
        userId: number;
        email: string;
        role: string;
        sessionId?: string;
        purpose?: string;
      };

      if (payload.purpose === "2fa_challenge") {
        return res.status(401).json({ error: "Complete 2FA verification first." });
      }

      if (!payload.sessionId) {
        return res.status(401).json({ error: "Invalid or expired token" });
      }

      const session = await findActiveSession(payload.sessionId);
      if (!session || session.userId !== payload.userId) {
        return res
          .status(401)
          .json({ error: "Session expired. Please sign in again." });
      }

      const idleMs = Date.now() - session.lastSeenAt.getTime();
      if (idleMs > IDLE_TIMEOUT_MS) {
        await revokeSession(payload.sessionId);
        return res
          .status(401)
          .json({ error: "Session timed out due to inactivity. Please sign in again." });
      }

      const user = await prisma.user.findUnique({
        where: { id: payload.userId },
        select: {
          id: true,
          email: true,
          role: true,
          lockedUntil: true,
        },
      });

      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }

      if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
        return res.status(403).json({ error: "Account is temporarily locked." });
      }

      void touchSession(payload.sessionId).catch(() => undefined);

      req.user = {
        userId: user.id,
        email: user.email,
        role: user.role,
        sessionId: payload.sessionId,
      };
      return next();
    } catch {
      return res.status(401).json({ error: "Invalid or expired token" });
    }
  })();
}

export function requirePermission(permission: Permission) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!hasPermission(req.user.role, permission)) {
      return res.status(403).json({
        error: "Forbidden. You do not have permission for this action.",
      });
    }

    return next();
  };
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (!isAdmin(req.user.role)) {
    return res.status(403).json({
      error: "Forbidden. Admin access required.",
    });
  }

  return next();
}

export function requireSuperadmin(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (!isSuperadmin(req.user.role)) {
    return res.status(403).json({
      error: "Forbidden. Superadmin access required.",
    });
  }

  return next();
}
