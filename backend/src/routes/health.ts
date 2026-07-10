import { Router } from "express";

export const healthRouter = Router();

healthRouter.get("/", (_req, res) => {
  res.json({
    status: "ok",
    service: "MR Database Tool API",
    timestamp: new Date().toISOString(),
  });
});
