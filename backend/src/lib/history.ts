import type { Request } from "express";
import { prisma } from "./prisma.js";

export type HistoryAction = "import" | "edit" | "restore" | "clear";

export type HistorySnapshotItem = {
  week: string;
  tabId: string;
  category?: string;
  columns: string[];
  rows: string[][];
  fileName?: string | null;
  sheetName?: string | null;
  location?: string | null;
};
 
export function getClientIp(req: Request): string | null {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0]?.trim() || null;
  }
  if (Array.isArray(forwarded) && forwarded[0]) {
    return String(forwarded[0]).split(",")[0]?.trim() || null;
  }
  const realIp = req.headers["x-real-ip"];
  if (typeof realIp === "string" && realIp.trim()) return realIp.trim();

  const ip = req.ip || req.socket.remoteAddress || null;
  if (!ip) return null;
  // Normalize IPv6-mapped IPv4
  return ip.startsWith("::ffff:") ? ip.slice(7) : ip;
}

function asStringMatrix(value: unknown): string[][] {
  if (!Array.isArray(value)) return [];
  return value.map((row) =>
    Array.isArray(row) ? row.map((cell) => (cell == null ? "" : String(cell))) : [],
  );
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((cell) => (cell == null ? "" : String(cell)));
}

export async function recordReportHistory(params: {
  req: Request;
  marketId: string;
  action: HistoryAction;
  label: string;
  fileName?: string | null;
  items: HistorySnapshotItem[];
}) {
  const { req, marketId, action, label, fileName, items } = params;
  if (!marketId || items.length === 0) return null;

  const weeks = [
    ...new Set(
      items
        .map((item) => String(item.week ?? "").trim().toUpperCase())
        .filter(Boolean),
    ),
  ].sort((a, b) => b.localeCompare(a));

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

  const ipAddress = getClientIp(req);
  const userAgentRaw = String(req.headers["user-agent"] ?? "").trim();
  const userAgent = userAgentRaw ? userAgentRaw.slice(0, 512) : null;

  // Parent first, then items one-by-one — nested create of large week-detail /
  // aff-raw snapshots often hits MySQL packet limits (write ECONNRESET).
  const history = await prisma.reportHistory.create({
    data: {
      marketId,
      action,
      label: label.slice(0, 512),
      weeks: weeks.join(", "),
      fileName: fileName ?? null,
      userId,
      userEmail,
      userName,
      ipAddress,
      userAgent,
      itemCount: items.length,
    },
  });

  try {
    for (const item of items) {
      await prisma.reportHistoryItem.create({
        data: {
          historyId: history.id,
          week: String(item.week ?? "").trim() || "unknown",
          tabId: String(item.tabId ?? "").trim(),
          category: String(item.category ?? "").trim(),
          columns: asStringArray(item.columns),
          rows: asStringMatrix(item.rows),
          fileName: item.fileName ?? fileName ?? null,
          sheetName: item.sheetName ?? null,
          location: item.location ?? null,
        },
      });
    }
  } catch (error) {
    await prisma.reportHistory.delete({ where: { id: history.id } }).catch(() => {});
    throw error;
  }

  await enforceHistoryLimit(marketId);

  const itemMeta = await prisma.reportHistoryItem.findMany({
    where: { historyId: history.id },
    select: {
      id: true,
      week: true,
      tabId: true,
      category: true,
    },
  });

  return { ...history, items: itemMeta };
}

/** Hard cap of retained history entries per market (FIFO — oldest removed). */
export const MAX_HISTORY_PER_MARKET = 100;

/**
 * Keep at most `limit` history entries for a market (FIFO): once the cap is
 * exceeded, the oldest entries are deleted first (items cascade-delete).
 */
export async function enforceHistoryLimit(
  marketId: string,
  limit = MAX_HISTORY_PER_MARKET,
): Promise<number> {
  const keep = Math.max(1, limit);
  const entries = await prisma.reportHistory.findMany({
    where: { marketId },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  const toDelete = entries.slice(keep).map((entry) => entry.id);
  if (toDelete.length === 0) return 0;
  const result = await prisma.reportHistory.deleteMany({
    where: { id: { in: toDelete } },
  });
  return result.count;
}

export { asStringArray, asStringMatrix };
