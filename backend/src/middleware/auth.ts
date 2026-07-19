import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import {
  hasPermission,
  isAdmin,
  isSuperadmin,
  type Permission,
} from "../lib/roles.js";
import { findActiveSession, touchSession } from "../lib/sessions.js";

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

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid token" });
  }

  const token = header.slice("Bearer ".length);
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    return res.status(500).json({ error: "JWT_SECRET is not configured" });
  }

  void (async () => {
    try {
      const payload = jwt.verify(token, secret) as AuthUser & {
        sessionId?: string;
      };

      if (!payload.sessionId) {
        return res.status(401).json({ error: "Invalid or expired token" });
      }

      const session = await findActiveSession(payload.sessionId);
      if (!session || session.userId !== payload.userId) {
        return res.status(401).json({ error: "Session expired. Please sign in again." });
      }

      // Refresh presence without blocking the response on failure.
      void touchSession(payload.sessionId).catch(() => undefined);

      req.user = {
        userId: payload.userId,
        email: payload.email,
        role: payload.role,
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
