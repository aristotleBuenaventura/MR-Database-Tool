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

// Always load backend/.env even when PM2 cwd is not the backend folder
dotenv.config({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env"),
});

const app = express();
const port = Number(process.env.PORT ?? 4000);
const corsOrigin = process.env.CORS_ORIGIN ?? "http://localhost:5173";

// So req.ip / x-forwarded-for work behind nginx / reverse proxies.
app.set("trust proxy", 1);

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
  startBackupScheduler();
});
