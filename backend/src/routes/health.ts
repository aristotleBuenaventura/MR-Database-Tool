import { Router } from "express";
import { getDbConfigSummary, prisma } from "../lib/prisma.js";

export const healthRouter = Router();

healthRouter.get("/", async (_req, res) => {
  let db: "ok" | "error" = "ok";
  let dbError: string | undefined;

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    db = "error";
    dbError = err instanceof Error ? err.message : String(err);
  }

  res.status(db === "ok" ? 200 : 503).json({
    status: db === "ok" ? "ok" : "degraded",
    service: "MR Database Tool API",
    timestamp: new Date().toISOString(),
    db,
    dbConfig: getDbConfigSummary(),
    ...(dbError ? { dbError } : {}),
  });
});
