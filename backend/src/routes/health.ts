import { Router } from "express";
import { prisma } from "../lib/prisma.js";

export const healthRouter = Router();

healthRouter.get("/", async (_req, res) => {
  let db: "ok" | "error" = "ok";

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    db = "error";
    console.error(
      "[health] database check failed",
      err instanceof Error ? err.message : err,
    );
  }

  res.status(db === "ok" ? 200 : 503).json({
    status: db === "ok" ? "ok" : "degraded",
    service: "MR Database Tool API",
    timestamp: new Date().toISOString(),
    db,
  });
});
