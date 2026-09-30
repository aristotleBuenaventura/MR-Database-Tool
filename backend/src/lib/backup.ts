import { prisma } from "./prisma.js";
import { asStringArray, asStringMatrix } from "./history.js";

/** Legacy global schedule, used only as the default until a brand saves its own. */
const SCHEDULE_KEY = "backup_schedule";

function scheduleKey(marketId: string): string {
  return `backup_schedule:${marketId.trim()}`;
}

function claimKey(marketId: string): string {
  return `backup_last_run:${marketId.trim()}`;
}

export type BackupSchedule = {
  /** When true, a backup runs automatically once per day. */
  enabled: boolean;
  /** Time of day in 24h "HH:mm", interpreted in Philippine time (Asia/Manila). */
  time: string;
  /** How many scheduled backups to keep (older scheduled backups are pruned). */
  retention: number;
  /** Last date (PH, "YYYY-MM-DD") an auto-backup ran, to avoid duplicate runs. */
  lastRunDate: string | null;
};

const DEFAULT_SCHEDULE: BackupSchedule = {
  enabled: false,
  time: "02:00",
  retention: 14,
  lastRunDate: null,
};

/** Hard cap of retained backups per market (FIFO — oldest removed first). */
export const MAX_BACKUPS_PER_MARKET = 20;

export const BACKUP_TIME_ZONE = "Asia/Manila";

/** Current date + time in Philippine time. */
export function philippineNow(): { date: string; time: string } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: BACKUP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date());
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  let hour = get("hour");
  if (hour === "24") hour = "00"; // some engines emit 24 for midnight
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${hour}:${get("minute")}`,
  };
}

function normalizeTime(value: unknown): string {
  const text = String(value ?? "").trim();
  const match = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (!match) return DEFAULT_SCHEDULE.time;
  const hh = Math.min(23, Math.max(0, Number(match[1])));
  const mm = Math.min(59, Math.max(0, Number(match[2])));
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function parseSchedule(value: string): BackupSchedule | null {
  try {
    const parsed = JSON.parse(value) as Partial<BackupSchedule>;
    return {
      enabled: Boolean(parsed.enabled),
      time: normalizeTime(parsed.time),
      retention:
        Number.isFinite(parsed.retention) && Number(parsed.retention) > 0
          ? Math.min(365, Math.floor(Number(parsed.retention)))
          : DEFAULT_SCHEDULE.retention,
      lastRunDate:
        typeof parsed.lastRunDate === "string" ? parsed.lastRunDate : null,
    };
  } catch {
    return null;
  }
}

async function readSchedule(key: string): Promise<BackupSchedule | null> {
  const row = await prisma.appSetting.findUnique({ where: { key } });
  if (!row) return null;
  return parseSchedule(row.value);
}

/**
 * Schedule for one brand. A brand with no saved schedule inherits the old
 * global time, but not another brand's last-run date.
 */
export async function getBackupSchedule(marketId: string): Promise<BackupSchedule> {
  const own = await readSchedule(scheduleKey(marketId));
  if (own) return own;

  const inherited = await readSchedule(SCHEDULE_KEY);
  if (inherited) return { ...inherited, lastRunDate: null };
  return { ...DEFAULT_SCHEDULE };
}

async function writeSchedule(
  marketId: string,
  schedule: BackupSchedule,
): Promise<void> {
  const key = scheduleKey(marketId);
  const value = JSON.stringify(schedule);
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}

/**
 * Atomically claim today's auto-backup slot. Returns true only for the single
 * caller that wins the race (safe even with multiple server processes), thanks
 * to the row-level lock taken by the conditional UPDATE.
 */
async function claimDailyRun(marketId: string, date: string): Promise<boolean> {
  const key = claimKey(marketId);
  // Ensure the claim row exists without clobbering an existing value.
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value: "" },
    update: {},
  });
  const claimed = await prisma.appSetting.updateMany({
    where: { key, value: { not: date } },
    data: { value: date },
  });
  return claimed.count === 1;
}

export async function updateBackupSchedule(
  marketId: string,
  partial: Partial<Pick<BackupSchedule, "enabled" | "time" | "retention">>,
): Promise<BackupSchedule> {
  const current = await getBackupSchedule(marketId);
  // Re-arm today's run when the enabled flag or time changes, so a new time
  // takes effect the same day even if an auto-backup already ran earlier.
  const timeChanged =
    partial.time !== undefined && normalizeTime(partial.time) !== current.time;
  const enabledChanged =
    partial.enabled !== undefined && Boolean(partial.enabled) !== current.enabled;
  const reArm = timeChanged || enabledChanged;

  const next: BackupSchedule = {
    ...current,
    ...(partial.enabled !== undefined ? { enabled: Boolean(partial.enabled) } : {}),
    ...(partial.time !== undefined ? { time: normalizeTime(partial.time) } : {}),
    ...(partial.retention !== undefined
      ? {
          retention:
            Number.isFinite(partial.retention) && Number(partial.retention) > 0
              ? Math.min(365, Math.floor(Number(partial.retention)))
              : current.retention,
        }
      : {}),
    ...(reArm ? { lastRunDate: null } : {}),
  };
  await writeSchedule(marketId, next);
  if (reArm) {
    // Clear this brand's daily claim so the next matching time can run today.
    await prisma.appSetting.deleteMany({ where: { key: claimKey(marketId) } });
  }
  return next;
}

export type BackupCreator = {
  userId?: number | null;
  userEmail?: string | null;
  userName?: string | null;
};

/**
 * Capture one market's report datasets into a new backup snapshot.
 * Returns the created backup header (or null when the market has no data).
 */
export async function createBackup(params: {
  marketId: string;
  label?: string | null;
  trigger: "manual" | "scheduled";
  creator?: BackupCreator;
}) {
  const { marketId, trigger, creator } = params;

  const datasets = await prisma.reportDataset.findMany({
    where: { marketId },
    select: {
      marketId: true,
      week: true,
      tabId: true,
      category: true,
      columns: true,
      rows: true,
      fileName: true,
      sheetName: true,
      location: true,
    },
  });

  let rowCount = 0;
  const items = datasets.map((dataset) => {
    const rows = asStringMatrix(dataset.rows);
    rowCount += rows.length;
    return {
      marketId: dataset.marketId,
      week: dataset.week,
      tabId: dataset.tabId,
      category: dataset.category,
      columns: asStringArray(dataset.columns),
      rows,
      fileName: dataset.fileName,
      sheetName: dataset.sheetName,
      location: dataset.location,
    };
  });

  const label =
    (params.label && params.label.trim()) ||
    `${trigger === "scheduled" ? "Auto" : "Manual"} backup`;

  const backup = await prisma.reportBackup.create({
    data: {
      marketId,
      label: label.slice(0, 512),
      trigger,
      itemCount: items.length,
      rowCount,
      userId: creator?.userId ?? null,
      userEmail: creator?.userEmail ?? null,
      userName: creator?.userName ?? null,
    },
  });

  // Insert dataset snapshots in chunks to stay within packet/pool limits.
  const CHUNK = 50;
  for (let i = 0; i < items.length; i += CHUNK) {
    const slice = items.slice(i, i + CHUNK);
    await prisma.reportBackupItem.createMany({
      data: slice.map((item) => ({
        backupId: backup.id,
        marketId: item.marketId,
        week: item.week,
        tabId: item.tabId,
        category: item.category,
        columns: item.columns,
        rows: item.rows,
        fileName: item.fileName,
        sheetName: item.sheetName,
        location: item.location,
      })),
    });
  }

  await enforceBackupLimit(marketId);

  return backup;
}

/**
 * Keep at most `limit` backups for a market (FIFO): once the cap is exceeded,
 * the oldest backups are deleted first.
 */
export async function enforceBackupLimit(
  marketId: string,
  limit = MAX_BACKUPS_PER_MARKET,
): Promise<number> {
  const keep = Math.max(1, limit);
  const backups = await prisma.reportBackup.findMany({
    where: { marketId },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  const toDelete = backups.slice(keep).map((backup) => backup.id);
  if (toDelete.length === 0) return 0;
  const result = await prisma.reportBackup.deleteMany({
    where: { id: { in: toDelete } },
  });
  return result.count;
}

/**
 * Restore a backup: replace the backup's market datasets with the snapshot
 * (true point-in-time restore for that market only).
 */
export async function restoreBackup(id: number): Promise<{ restored: number }> {
  const backup = await prisma.reportBackup.findUnique({
    where: { id },
    select: { id: true, marketId: true },
  });
  if (!backup) {
    throw new Error("Backup not found");
  }

  const items = await prisma.reportBackupItem.findMany({
    where: { backupId: id },
  });

  await prisma.$transaction(async (tx) => {
    await tx.reportDataset.deleteMany({ where: { marketId: backup.marketId } });
    const CHUNK = 50;
    for (let i = 0; i < items.length; i += CHUNK) {
      const slice = items.slice(i, i + CHUNK);
      await tx.reportDataset.createMany({
        data: slice.map((item) => ({
          marketId: item.marketId,
          week: item.week,
          tabId: item.tabId,
          category: item.category,
          columns: asStringArray(item.columns),
          rows: asStringMatrix(item.rows),
          fileName: item.fileName,
          sheetName: item.sheetName,
          location: item.location,
        })),
      });
    }
  });

  return { restored: items.length };
}

let schedulerStarted = false;
let running = false;

/**
 * Lightweight scheduler: every 30s, compare the configured PH time to "now".
 * When it matches and today's auto-backup hasn't run yet, create one.
 */
export function startBackupScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const { date, time } = philippineNow();
      const markets = await prisma.reportDataset.findMany({
        distinct: ["marketId"],
        select: { marketId: true },
      });

      let completed = 0;
      for (const { marketId } of markets) {
        const schedule = await getBackupSchedule(marketId);
        if (!schedule.enabled) continue;
        if (time !== schedule.time) continue;
        if (schedule.lastRunDate === date) continue;

        const won = await claimDailyRun(marketId, date);
        if (!won) continue;

        await writeSchedule(marketId, { ...schedule, lastRunDate: date });
        await createBackup({ marketId, trigger: "scheduled" });
        completed += 1;
      }

      if (completed > 0) {
        console.log(
          `[backup] Auto-backup completed for ${completed} market(s) at ${date} ${time} (PH).`,
        );
      }
    } catch (error) {
      console.error("[backup] Auto-backup failed:", error);
    } finally {
      running = false;
    }
  };

  setInterval(() => {
    void tick();
  }, 30_000);
  console.log("[backup] Auto-backup scheduler started (Asia/Manila).");
}
