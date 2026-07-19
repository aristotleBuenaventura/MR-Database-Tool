import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma.js";
import { ROLES } from "../lib/roles.js";
import { createSession, revokeSession } from "../lib/sessions.js";
import { requireAuth } from "../middleware/auth.js";

export const authRouter = Router();

authRouter.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body as {
      email?: string;
      password?: string;
    };

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      return res.status(500).json({ error: "JWT_SECRET is not configured" });
    }

    const session = await createSession(user.id, req);

    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        role: user.role,
        sessionId: session.id,
      },
      secret,
      { expiresIn: "7d" },
    );

    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("[auth/login]", error);
    return res.status(500).json({ error: "Failed to login" });
  }
});

authRouter.post("/logout", requireAuth, async (req, res) => {
  try {
    await revokeSession(req.user!.sessionId);
    return res.json({ ok: true });
  } catch (error) {
    console.error("[auth/logout]", error);
    return res.status(500).json({ error: "Failed to logout" });
  }
});

authRouter.get("/me", requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    return res.json({
      user,
      capabilities: {
        canEdit: user.role === ROLES.ADMIN,
        canImportExport: user.role === ROLES.ADMIN,
        isViewer: user.role === ROLES.VIEWER,
        isAdmin: user.role === ROLES.ADMIN,
        isSuperadmin: user.role === ROLES.SUPERADMIN,
        canManageUsers: user.role === ROLES.SUPERADMIN,
      },
    });
  } catch (error) {
    console.error("Me error:", error);
    return res.status(500).json({ error: "Failed to fetch user" });
  }
});
