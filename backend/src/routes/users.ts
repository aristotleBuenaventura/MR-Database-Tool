import { Router } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma.js";
import {
  isManageableRole,
  ROLES,
  type ManageableRole,
} from "../lib/roles.js";
import {
  isOnline,
  revokeSession,
  revokeUserSessions,
} from "../lib/sessions.js";
import { requireAuth, requireSuperadmin } from "../middleware/auth.js";

export const usersRouter = Router();

usersRouter.use(requireAuth, requireSuperadmin);

function sessionSummary(
  sessions: Array<{ id: string; lastSeenAt: Date; createdAt: Date; ipAddress: string | null; userAgent: string | null }>,
) {
  const now = new Date();
  const active = sessions.map((session) => ({
    id: session.id,
    createdAt: session.createdAt,
    lastSeenAt: session.lastSeenAt,
    ipAddress: session.ipAddress,
    userAgent: session.userAgent,
    online: isOnline(session.lastSeenAt, now),
  }));

  return {
    online: active.some((s) => s.online),
    activeSessions: active,
  };
}

usersRouter.get("/", async (_req, res) => {
  try {
    const users = await prisma.user.findMany({
      orderBy: [{ role: "asc" }, { email: "asc" }],
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
        updatedAt: true,
        sessions: {
          where: { revokedAt: null },
          select: {
            id: true,
            createdAt: true,
            lastSeenAt: true,
            ipAddress: true,
            userAgent: true,
          },
          orderBy: { lastSeenAt: "desc" },
        },
      },
    });

    return res.json({
      users: users.map((user) => {
        const presence = sessionSummary(user.sessions);
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
          online: presence.online,
          activeSessions: presence.activeSessions,
        };
      }),
    });
  } catch (error) {
    console.error("[users/list]", error);
    return res.status(500).json({ error: "Failed to list users" });
  }
});

usersRouter.post("/", async (req, res) => {
  try {
    const { email, password, name, role } = req.body as {
      email?: string;
      password?: string;
      name?: string;
      role?: string;
    };

    if (!email?.trim() || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    if (password.length < 8) {
      return res
        .status(400)
        .json({ error: "Password must be at least 8 characters" });
    }

    if (!role || !isManageableRole(role)) {
      return res.status(400).json({
        error: "Role must be viewer or admin",
      });
    }

    const existing = await prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
    if (existing) {
      return res.status(409).json({ error: "Email is already registered" });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        email: email.trim().toLowerCase(),
        passwordHash,
        name: name?.trim() || null,
        role: role as ManageableRole,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
      },
    });

    return res.status(201).json({ user });
  } catch (error) {
    console.error("[users/create]", error);
    return res.status(500).json({ error: "Failed to create user" });
  }
});

usersRouter.patch("/:id/password", async (req, res) => {
  try {
    const userId = Number(req.params.id);
    if (!Number.isInteger(userId) || userId < 1) {
      return res.status(400).json({ error: "Invalid user id" });
    }

    const { password } = req.body as { password?: string };
    if (!password || password.length < 8) {
      return res
        .status(400)
        .json({ error: "Password must be at least 8 characters" });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Only allow password changes for manageable roles + own superadmin account.
    if (
      user.role === ROLES.SUPERADMIN &&
      user.id !== req.user!.userId
    ) {
      return res.status(403).json({
        error: "Cannot change another superadmin password",
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });

    // Force re-login after password change (except keep current session if self).
    if (user.id === req.user!.userId) {
      await prisma.userSession.updateMany({
        where: {
          userId,
          revokedAt: null,
          NOT: { id: req.user!.sessionId },
        },
        data: { revokedAt: new Date() },
      });
    } else {
      await revokeUserSessions(userId);
    }

    return res.json({ ok: true });
  } catch (error) {
    console.error("[users/password]", error);
    return res.status(500).json({ error: "Failed to change password" });
  }
});

usersRouter.post("/sessions/:sessionId/logout", async (req, res) => {
  try {
    const sessionId = String(req.params.sessionId ?? "").trim();
    if (!sessionId) {
      return res.status(400).json({ error: "Invalid session id" });
    }

    if (sessionId === req.user!.sessionId) {
      return res.status(400).json({
        error: "Use Sign out for your own session",
      });
    }

    const session = await prisma.userSession.findUnique({
      where: { id: sessionId },
    });
    if (!session || session.revokedAt) {
      return res.status(404).json({ error: "Session not found" });
    }

    await revokeSession(sessionId);
    return res.json({ ok: true });
  } catch (error) {
    console.error("[users/session-logout]", error);
    return res.status(500).json({ error: "Failed to logout session" });
  }
});

usersRouter.post("/:id/logout", async (req, res) => {
  try {
    const userId = Number(req.params.id);
    if (!Number.isInteger(userId) || userId < 1) {
      return res.status(400).json({ error: "Invalid user id" });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (user.id === req.user!.userId) {
      return res.status(400).json({
        error: "Use Sign out for your own session",
      });
    }

    const count = await revokeUserSessions(userId);
    return res.json({ ok: true, revoked: count });
  } catch (error) {
    console.error("[users/logout]", error);
    return res.status(500).json({ error: "Failed to logout user sessions" });
  }
});
