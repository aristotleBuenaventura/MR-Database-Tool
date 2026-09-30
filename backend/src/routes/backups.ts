import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { rejectIfPasswordWrong } from "../lib/confirmPassword.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import {
  BACKUP_TIME_ZONE,
  createBackup,
  getBackupSchedule,
  restoreBackup,
  updateBackupSchedule,
} from "../lib/backup.js";

export const backupsRouter = Router();

backupsRouter.use(requireAuth);

/** List a market's backups (newest first) + the current auto-backup schedule. */
backupsRouter.get("/", async (req, res) => {
  try {
    const marketId = String(req.query.marketId ?? "").trim();
    if (!marketId) {
      return res.status(400).json({ error: "marketId is required" });
    }
    const [backups, schedule] = await Promise.all([
      prisma.reportBackup.findMany({
        where: { marketId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          marketId: true,
          label: true,
          trigger: true,
          itemCount: true,
          rowCount: true,
          userEmail: true,
          userName: true,
          createdAt: true,
        },
      }),
      getBackupSchedule(marketId),
    ]);
    return res.json({ backups, schedule, timeZone: BACKUP_TIME_ZONE });
  } catch (error) {
    console.error("List backups error:", error);
    return res.status(500).json({ error: "Failed to load backups" });
  }
});

/** Create a manual backup now for one market. */
backupsRouter.post("/", requirePermission("importExcel"), async (req, res) => {
  try {
    const marketId = String(req.body?.marketId ?? "").trim();
    if (!marketId) {
      return res.status(400).json({ error: "marketId is required" });
    }
    const label = String(req.body?.label ?? "").trim() || null;
    const userId = req.user?.userId ?? null;
    let userEmail = req.user?.email ?? null;
    let userName: string | null = null;
    if (userId != null) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, name: true },
      });
      if (user) {
        userEmail = user.email;
        userName = user.name;
      }
    }

    const backup = await createBackup({
      marketId,
      label,
      trigger: "manual",
      creator: { userId, userEmail, userName },
    });
    return res.json({
      backup: {
        id: backup.id,
        marketId: backup.marketId,
        label: backup.label,
        trigger: backup.trigger,
        itemCount: backup.itemCount,
        rowCount: backup.rowCount,
        createdAt: backup.createdAt,
      },
    });
  } catch (error) {
    console.error("Create backup error:", error);
    return res.status(500).json({ error: "Failed to create backup" });
  }
});

/** Restore all datasets from a backup (replaces current data). */
backupsRouter.post(
  "/:id/restore",
  requirePermission("importExcel"),
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(400).json({ error: "Invalid backup id" });
      }
      const rejected = await rejectIfPasswordWrong(
        req.user?.userId,
        req.body?.password,
      );
      if (rejected) {
        return res.status(rejected.status).json({ error: rejected.error });
      }
      const result = await restoreBackup(id);
      return res.json(result);
    } catch (error) {
      const message =
        error instanceof Error && error.message === "Backup not found"
          ? "Backup not found"
          : "Failed to restore backup";
      const status = message === "Backup not found" ? 404 : 500;
      console.error("Restore backup error:", error);
      return res.status(status).json({ error: message });
    }
  },
);

/** Delete a backup snapshot. */
backupsRouter.delete("/:id", requirePermission("importExcel"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "Invalid backup id" });
    }
    await prisma.reportBackup.delete({ where: { id } });
    return res.json({ deleted: true });
  } catch (error) {
    console.error("Delete backup error:", error);
    return res.status(500).json({ error: "Failed to delete backup" });
  }
});

/** Update the auto-backup schedule (time is Philippine time). */
backupsRouter.put("/schedule", requirePermission("importExcel"), async (req, res) => {
  try {
    const marketId = String(req.body?.marketId ?? "").trim();
    if (!marketId) {
      return res.status(400).json({ error: "marketId is required" });
    }
    const schedule = await updateBackupSchedule(marketId, {
      enabled:
        req.body?.enabled !== undefined ? Boolean(req.body.enabled) : undefined,
      time: req.body?.time !== undefined ? String(req.body.time) : undefined,
      retention:
        req.body?.retention !== undefined ? Number(req.body.retention) : undefined,
    });
    return res.json({ schedule, timeZone: BACKUP_TIME_ZONE });
  } catch (error) {
    console.error("Update backup schedule error:", error);
    return res.status(500).json({ error: "Failed to update schedule" });
  }
});
