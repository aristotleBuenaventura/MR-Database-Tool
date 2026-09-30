import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { healthRouter } from "./routes/health.js";
import { authRouter } from "./routes/auth.js";
import { reportsRouter } from "./routes/reports.js";
import { adminRouter } from "./routes/admin.js";
import { backupsRouter } from "./routes/backups.js";
import { usersRouter } from "./routes/users.js";
import { startBackupScheduler } from "./lib/backup.js";
import { ipAllowlist } from "./middleware/auth.js";
import { trustProxyEnabled } from "./lib/securityConfig.js";
import { sealExistingTotpSecrets } from "./lib/totpSecret.js";

// Always load backend/.env even when PM2 cwd is not the backend folder
dotenv.config({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env"),
});

const app = express();
const port = Number(process.env.PORT ?? 4000);
const corsOrigin = process.env.CORS_ORIGIN ?? "http://localhost:5173";

// Only trust X-Forwarded-For when a reverse proxy is actually in front.
if (trustProxyEnabled()) {
  app.set("trust proxy", 1);
}

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'"],
        "style-src": ["'self'", "'unsafe-inline'"],
        "img-src": ["'self'", "data:"],
        "connect-src": ["'self'", corsOrigin],
        "frame-ancestors": ["'none'"],
        "base-uri": ["'self'"],
        "form-action": ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts:
      process.env.NODE_ENV === "production"
        ? { maxAge: 63_072_000, includeSubDomains: true, preload: true }
        : false,
  }),
);

app.use(
  cors({
    origin: corsOrigin,
    credentials: true,
  }),
);
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT ?? "100mb" }));
app.use(cookieParser());
app.use(ipAllowlist);

app.use("/api/health", healthRouter);
app.use("/api/auth", authRouter);
app.use("/api/reports", reportsRouter);
app.use("/api/backups", backupsRouter);
app.use("/api/users", usersRouter);
app.use("/api/admin", adminRouter);

app.get("/", (_req, res) => {
  res.json({ message: "MR Database Tool API" });
});

app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    if (
      err &&
      typeof err === "object" &&
      "type" in err &&
      (err as { type?: string }).type === "entity.too.large"
    ) {
      return res.status(413).json({
        error:
          "Upload is too large. Try importing fewer sheets/weeks, or raise JSON_BODY_LIMIT on the server.",
      });
    }
    return next(err);
  },
);

app.listen(port, () => {
  console.log(`API running at http://localhost:${port}`);
  const jwtSecret = process.env.JWT_SECRET ?? "";
  if (jwtSecret.length < 32) {
    console.warn(
      "[security] JWT_SECRET should be at least 32 characters. Rotating it signs everyone out.",
    );
  }
  if (process.env.NODE_ENV !== "production") {
    console.warn(
      "[security] NODE_ENV is not production, so the session cookie is not Secure and HSTS is off. On the public HTTPS server set NODE_ENV=production, COOKIE_SECURE=true, and TRUST_PROXY=1.",
    );
  }
  startBackupScheduler();
  void sealExistingTotpSecrets()
    .then((count) => {
      if (count > 0) {
        console.log(`[security] Sealed ${count} authenticator secret(s).`);
      }
    })
    .catch((error) => {
      console.error("[security] Could not seal authenticator secrets", error);
    });
});
