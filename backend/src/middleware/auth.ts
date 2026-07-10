import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { hasPermission, isAdmin, type Permission } from "../lib/roles.js";

export type AuthUser = {
  userId: number;
  email: string;
  role: string;
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

  try {
    const payload = jwt.verify(token, secret) as AuthUser;
    req.user = payload;
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function requirePermission(permission: Permission) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!hasPermission(req.user.role, permission)) {
      return res.status(403).json({
        error: "Forbidden. Viewer accounts are read-only.",
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
