import { createHash, timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { prisma } from "../lib/prisma.js";

export const adminRouter = Router();

function tokenMatches(provided: string, expected: string): boolean {
  if (!provided || !expected) return false;
  const left = createHash("sha256").update(provided).digest();
  const right = createHash("sha256").update(expected).digest();
  return timingSafeEqual(left, right);
}

function readClearToken(req: {
  query: Record<string, unknown>;
  headers: Record<string, unknown>;
}): string {
  const fromQuery = String(req.query.token ?? "").trim();
  if (fromQuery) return fromQuery;

  const header = String(req.headers["x-admin-token"] ?? "").trim();
  if (header) return header;

  const auth = String(req.headers.authorization ?? "").trim();
  if (auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  return "";
}

/**
 * Clear all uploaded/computed report rows. Users stay intact.
 *
 * Browser-friendly (no UI link — paste URL with token):
 *   GET  /api/admin/clear-reports?token=YOUR_SECRET&confirm=YES
 *   POST /api/admin/clear-reports?token=YOUR_SECRET&confirm=YES
 *
 * Set ADMIN_CLEAR_TOKEN in backend/.env (long random string).
 * If ADMIN_CLEAR_TOKEN is unset/empty, the endpoint returns 404.
 */
async function clearReports(req: {
  query: Record<string, unknown>;
  headers: Record<string, unknown>;
}, res: import("express").Response) {
  const expected = String(process.env.ADMIN_CLEAR_TOKEN ?? "").trim();
  if (!expected) {
    return res.status(404).json({ error: "Not found" });
  }

  const provided = readClearToken(req);
  if (!tokenMatches(provided, expected)) {
    return res.status(403).json({ error: "Invalid token" });
  }

  const confirm = String(req.query.confirm ?? "").trim().toUpperCase();
  if (confirm !== "YES") {
    return res.status(400).json({
      error: 'Add confirm=YES to clear report_datasets (users are kept).',
      example:
        "/api/admin/clear-reports?token=YOUR_SECRET&confirm=YES",
    });
  }

  try {
    const result = await prisma.reportDataset.deleteMany();
    console.warn(
      `[admin] Cleared report_datasets: ${result.count} row(s) deleted`,
    );
    return res.json({
      ok: true,
      deleted: result.count,
      kept: ["users"],
      message: "All report datasets cleared. Login accounts were not deleted.",
    });
  } catch (error) {
    console.error("Admin clear reports error:", error);
    return res.status(500).json({ error: "Failed to clear report data" });
  }
}

adminRouter.get("/clear-reports", (req, res) => {
  void clearReports(req, res);
});

adminRouter.post("/clear-reports", (req, res) => {
  void clearReports(req, res);
});
