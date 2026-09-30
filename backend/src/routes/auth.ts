import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import { prisma } from "../lib/prisma.js";
import { ROLES } from "../lib/roles.js";
import { auditSecurityEvent } from "../lib/audit.js";
import { clearAuthCookie, readAuthToken, setAuthCookie } from "../lib/cookies.js";
import {
  JWT_EXPIRES_IN,
  LOCKOUT_MINUTES,
  LOGIN_RATE_MAX,
  LOGIN_RATE_WINDOW_MS,
  FORGOT_PASSWORD_RATE_MAX,
} from "../lib/securityConfig.js";
import { sendPasswordResetEmail } from "../lib/email.js";
import {
  buildResetUrl,
  consumePasswordResetToken,
  createPasswordResetToken,
  forgotPasswordCooldownRemaining,
  markEmailCooldown,
  resetCooldownSeconds,
} from "../lib/passwordReset.js";
import { createSession, revokeSession, revokeUserSessions } from "../lib/sessions.js";
import {
  buildOtpauthUrl,
  generateTotpSecret,
  requires2faRole,
  verifyTotpCode,
} from "../lib/totp.js";
import { requireAuth } from "../middleware/auth.js";
import { recordFailedSignIn } from "../lib/lockout.js";
import { isSealedTotpSecret, openTotpSecret, sealTotpSecret } from "../lib/totpSecret.js";

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: LOGIN_RATE_WINDOW_MS,
  max: LOGIN_RATE_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please try again later." },
});

const forgotPasswordLimiter = rateLimit({
  windowMs: LOGIN_RATE_WINDOW_MS,
  max: FORGOT_PASSWORD_RATE_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many password reset requests. Please try again later.",
  },
});

const resetPasswordLimiter = rateLimit({
  windowMs: LOGIN_RATE_WINDOW_MS,
  max: FORGOT_PASSWORD_RATE_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many reset attempts. Please try again later." },
});

function capabilitiesFor(user: {
  role: string;
  totpEnabled: boolean;
}) {
  const needs2fa = requires2faRole(user.role);
  return {
    canEdit: user.role === ROLES.ADMIN,
    canImportExport: user.role === ROLES.ADMIN,
    isViewer: user.role === ROLES.VIEWER,
    isAdmin: user.role === ROLES.ADMIN,
    isSuperadmin: user.role === ROLES.SUPERADMIN,
    canManageUsers: user.role === ROLES.SUPERADMIN,
    mustSetup2fa: needs2fa && !user.totpEnabled,
    totpEnabled: user.totpEnabled,
  };
}

async function issueSession(
  req: Parameters<typeof createSession>[1],
  res: import("express").Response,
  user: { id: number; email: string; name: string | null; role: string; totpEnabled: boolean },
) {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    return res.status(500).json({ error: "JWT_SECRET is not configured" });
  }

  let session;
  try {
    session = await createSession(user.id, req);
  } catch (error) {
    console.error("[auth] createSession failed", error);
    return res.status(500).json({
      error:
        "Could not start a login session. Run database migrations and restart the API.",
    });
  }

  let token: string;
  try {
    token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        role: user.role,
        sessionId: session.id,
      },
      secret,
      { expiresIn: JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"] },
    );
  } catch (error) {
    console.error("[auth] jwt.sign failed", error);
    return res.status(500).json({ error: "Server auth configuration error" });
  }

  setAuthCookie(res, token);

  return res.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    },
    capabilities: capabilitiesFor(user),
  });
}

authRouter.post("/login", loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body as {
      email?: string;
      password?: string;
    };

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

    if (!user) {
      await auditSecurityEvent({
        event: "login_failed",
        req,
        email: normalizedEmail,
        detail: "unknown_email",
      });
      return res.status(401).json({ error: "Invalid email or password" });
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      await auditSecurityEvent({
        event: "login_locked",
        req,
        userId: user.id,
        email: user.email,
        detail: `locked_until=${user.lockedUntil.toISOString()}`,
      });
      return res.status(403).json({
        error: `Account locked. Try again after ${user.lockedUntil.toLocaleString()}.`,
      });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      const { lockedUntil, attempts } = await recordFailedSignIn(user);

      await auditSecurityEvent({
        event: lockedUntil ? "account_locked" : "login_failed",
        req,
        userId: user.id,
        email: user.email,
        detail: lockedUntil
          ? `lockout_${LOCKOUT_MINUTES}m`
          : `attempt=${attempts}`,
      });

      return res.status(401).json({ error: "Invalid email or password" });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });

    if (requires2faRole(user.role) && user.totpEnabled && user.totpSecret) {
      const secret = process.env.JWT_SECRET;
      if (!secret) {
        return res.status(500).json({ error: "JWT_SECRET is not configured" });
      }

      const challengeToken = jwt.sign(
        {
          userId: user.id,
          email: user.email,
          purpose: "2fa_challenge",
        },
        secret,
        { expiresIn: "5m" },
      );

      await auditSecurityEvent({
        event: "login_2fa_required",
        req,
        userId: user.id,
        email: user.email,
      });

      return res.json({
        requires2fa: true,
        challengeToken,
      });
    }

    await auditSecurityEvent({
      event: "login_success",
      req,
      userId: user.id,
      email: user.email,
    });

    return issueSession(req, res, user);
  } catch (error) {
    console.error("[auth/login]", error);
    const message =
      error instanceof Error && /connect|ECONNREFUSED|ER_|P1001|P1000/i.test(error.message)
        ? "Database connection failed. Check server configuration."
        : "Failed to login";
    return res.status(500).json({ error: message });
  }
});

authRouter.post("/2fa/verify", loginLimiter, async (req, res) => {
  try {
    const { challengeToken, code } = req.body as {
      challengeToken?: string;
      code?: string;
    };

    if (!challengeToken || !code) {
      return res.status(400).json({ error: "Challenge token and code are required" });
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      return res.status(500).json({ error: "JWT_SECRET is not configured" });
    }

    let payload: { userId: number; email: string; purpose?: string };
    try {
      payload = jwt.verify(challengeToken, secret) as typeof payload;
    } catch {
      return res.status(401).json({ error: "2FA challenge expired. Sign in again." });
    }

    if (payload.purpose !== "2fa_challenge") {
      return res.status(401).json({ error: "Invalid 2FA challenge" });
    }

    const user = await prisma.user.findUnique({ where: { id: payload.userId } });
    if (!user?.totpEnabled || !user.totpSecret) {
      return res.status(400).json({ error: "2FA is not enabled for this account" });
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      return res.status(403).json({
        error: `Account locked. Try again after ${user.lockedUntil.toLocaleString()}.`,
      });
    }

    let totpSecret = user.totpSecret;
    if (!isSealedTotpSecret(totpSecret)) {
      const plain = totpSecret;
      await prisma.user.update({
        where: { id: user.id },
        data: { totpSecret: sealTotpSecret(plain) },
      });
      totpSecret = plain;
    } else {
      totpSecret = openTotpSecret(totpSecret);
    }

    if (!verifyTotpCode(totpSecret, code)) {
      const { lockedUntil, attempts } = await recordFailedSignIn(user);
      await auditSecurityEvent({
        event: lockedUntil ? "account_locked" : "login_2fa_failed",
        req,
        userId: user.id,
        email: user.email,
        detail: lockedUntil
          ? `lockout_${LOCKOUT_MINUTES}m`
          : `attempt=${attempts}`,
      });
      if (lockedUntil) {
        return res.status(403).json({
          error: `Account locked. Try again after ${lockedUntil.toLocaleString()}.`,
        });
      }
      return res.status(401).json({ error: "Invalid authenticator code" });
    }

    await auditSecurityEvent({
      event: "login_success",
      req,
      userId: user.id,
      email: user.email,
      detail: "2fa",
    });

    return issueSession(req, res, user);
  } catch (error) {
    console.error("[auth/2fa/verify]", error);
    return res.status(500).json({ error: "Failed to verify 2FA" });
  }
});

authRouter.post("/forgot-password", forgotPasswordLimiter, async (req, res) => {
  const cooldownSec = resetCooldownSeconds();
  const sentMessage =
    "If an account exists for that email, a password reset link has been sent.";
  const waitMessage =
    "Please wait before requesting another reset link. Check your inbox (and spam) for the previous email.";

  try {
    const { email } = req.body as { email?: string };
    if (!email?.trim()) {
      return res.status(400).json({ error: "Email is required" });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    const remainingMs = await forgotPasswordCooldownRemaining(
      normalizedEmail,
      user?.id,
    );
    if (remainingMs > 0) {
      const retryAfterSeconds = Math.ceil(remainingMs / 1000);
      await auditSecurityEvent({
        event: "password_reset_requested",
        req,
        userId: user?.id,
        email: normalizedEmail,
        detail: `cooldown_${retryAfterSeconds}s`,
      });
      return res.status(429).json({
        error: waitMessage,
        retryAfterSeconds,
      });
    }

    // Always return the same success shape for unknown vs known (no enumeration).
    if (!user) {
      markEmailCooldown(normalizedEmail);
      await auditSecurityEvent({
        event: "password_reset_requested",
        req,
        email: normalizedEmail,
        detail: "unknown_email",
      });
      return res.json({
        ok: true,
        message: sentMessage,
        retryAfterSeconds: cooldownSec,
      });
    }

    const { token } = await createPasswordResetToken(user.id);
    const resetUrl = buildResetUrl(token);
    const delivery = await sendPasswordResetEmail({
      to: user.email,
      resetUrl,
    });
    markEmailCooldown(normalizedEmail);

    await auditSecurityEvent({
      event: "password_reset_requested",
      req,
      userId: user.id,
      email: user.email,
      detail: delivery.sent ? "email_sent" : "email_not_sent",
    });

    return res.json({
      ok: true,
      message: sentMessage,
      retryAfterSeconds: cooldownSec,
    });
  } catch (error) {
    console.error("[auth/forgot-password]", error);
    return res.status(500).json({ error: "Failed to process password reset" });
  }
});

authRouter.post("/reset-password", resetPasswordLimiter, async (req, res) => {
  try {
    const { token, password } = req.body as {
      token?: string;
      password?: string;
    };

    if (!token?.trim()) {
      return res.status(400).json({ error: "Reset token is required" });
    }
    if (!password || password.length < 8) {
      return res
        .status(400)
        .json({ error: "Password must be at least 8 characters" });
    }

    const user = await consumePasswordResetToken(token.trim());
    if (!user) {
      await auditSecurityEvent({
        event: "password_reset_failed",
        req,
        detail: "invalid_or_expired_token",
      });
      return res.status(400).json({
        error: "This reset link is invalid or has expired. Request a new one.",
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });

    await revokeUserSessions(user.id);

    await auditSecurityEvent({
      event: "password_reset_success",
      req,
      userId: user.id,
      email: user.email,
    });

    return res.json({
      ok: true,
      message: "Password updated. You can sign in with your new password.",
    });
  } catch (error) {
    console.error("[auth/reset-password]", error);
    return res.status(500).json({ error: "Failed to reset password" });
  }
});

authRouter.post("/logout", async (req, res) => {
  try {
    const secret = process.env.JWT_SECRET;
    const token = readAuthToken(req);
    if (token && secret) {
      try {
        const payload = jwt.verify(token, secret) as {
          userId?: number;
          email?: string;
          sessionId?: string;
        };
        if (payload.sessionId) {
          await revokeSession(payload.sessionId);
        }
        if (payload.userId && payload.email) {
          await auditSecurityEvent({
            event: "logout",
            req,
            userId: payload.userId,
            email: payload.email,
          });
        }
      } catch {
        // Expired/invalid token — still clear the cookie below.
      }
    }
    clearAuthCookie(res);
    return res.json({ ok: true });
  } catch (error) {
    console.error("[auth/logout]", error);
    clearAuthCookie(res);
    return res.json({ ok: true });
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
        totpEnabled: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    return res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        createdAt: user.createdAt,
      },
      capabilities: capabilitiesFor(user),
    });
  } catch (error) {
    console.error("Me error:", error);
    return res.status(500).json({ error: "Failed to fetch user" });
  }
});

authRouter.post("/2fa/setup", requireAuth, async (req, res) => {
  try {
    const { password } = req.body as { password?: string };
    if (!password) {
      return res.status(400).json({ error: "Password is required" });
    }

    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (!requires2faRole(user.role)) {
      return res.status(400).json({ error: "2FA is not required for this role" });
    }

    if (user.totpEnabled) {
      return res.status(403).json({
        error: "2FA is already enabled. It cannot be replaced from this session.",
      });
    }

    const validPassword = await bcrypt.compare(password, user.passwordHash);
    if (!validPassword) {
      return res.status(401).json({ error: "Incorrect password" });
    }

    const secret = generateTotpSecret();
    await prisma.user.update({
      where: { id: user.id },
      data: { totpSecret: sealTotpSecret(secret), totpEnabled: false },
    });

    await auditSecurityEvent({
      event: "2fa_setup_started",
      req,
      userId: user.id,
      email: user.email,
    });

    return res.json({
      secret,
      otpauthUrl: buildOtpauthUrl(user.email, secret),
    });
  } catch (error) {
    console.error("[auth/2fa/setup]", error);
    return res.status(500).json({ error: "Failed to start 2FA setup" });
  }
});

authRouter.post("/2fa/enable", requireAuth, async (req, res) => {
  try {
    const { code } = req.body as { code?: string };
    if (!code) {
      return res.status(400).json({ error: "Authenticator code is required" });
    }

    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    if (!user?.totpSecret) {
      return res.status(400).json({ error: "Start 2FA setup first" });
    }

    const totpSecret = openTotpSecret(user.totpSecret);
    if (!verifyTotpCode(totpSecret, code)) {
      return res.status(401).json({ error: "Invalid authenticator code" });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { totpEnabled: true },
    });

    await auditSecurityEvent({
      event: "2fa_enabled",
      req,
      userId: user.id,
      email: user.email,
    });

    return res.json({
      ok: true,
      capabilities: capabilitiesFor({ role: user.role, totpEnabled: true }),
    });
  } catch (error) {
    console.error("[auth/2fa/enable]", error);
    return res.status(500).json({ error: "Failed to enable 2FA" });
  }
});

authRouter.post("/2fa/disable", requireAuth, async (req, res) => {
  try {
    const { password, code } = req.body as { password?: string; code?: string };
    if (!password || !code) {
      return res
        .status(400)
        .json({ error: "Password and authenticator code are required" });
    }

    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: "Incorrect password" });
    }

    if (!user.totpSecret || !verifyTotpCode(openTotpSecret(user.totpSecret), code)) {
      return res.status(401).json({ error: "Invalid authenticator code" });
    }

    // Admin/superadmin cannot disable if 2FA is required for their role.
    if (requires2faRole(user.role)) {
      return res.status(403).json({
        error: "2FA is required for admin and superadmin accounts",
      });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { totpEnabled: false, totpSecret: null },
    });

    await auditSecurityEvent({
      event: "2fa_disabled",
      req,
      userId: user.id,
      email: user.email,
    });

    return res.json({ ok: true });
  } catch (error) {
    console.error("[auth/2fa/disable]", error);
    return res.status(500).json({ error: "Failed to disable 2FA" });
  }
});
