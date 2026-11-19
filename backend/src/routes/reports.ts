import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import {
  asStringArray,
  asStringMatrix,
  recordReportHistory,
  type HistorySnapshotItem,
} from "../lib/history.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { rejectIfPasswordWrong } from "../lib/confirmPassword.js";

export const reportsRouter = Router();

type SaveBody = {
  marketId?: string;
  week?: string;
  tabId?: string;
  category?: string;
  columns?: string[];
  rows?: string[][];
  fileName?: string | null;
  sheetName?: string | null;
  location?: string | null;
  historyLabel?: string | null;
};

reportsRouter.use(requireAuth);

reportsRouter.get("/", async (req, res) => {
  try {
    const marketId = String(req.query.marketId ?? "").trim();
    const week = String(req.query.week ?? "").trim();
    const tabId = String(req.query.tabId ?? "").trim();
    const category = String(req.query.category ?? "").trim();

    if (!marketId || !week || !tabId) {
      return res.status(400).json({
        error: "marketId, week, and tabId are required",
      });
    }

    const dataset = await prisma.reportDataset.findUnique({
      where: {
        marketId_week_tabId_category: {
          marketId,
          week,
          tabId,
          category,
        },
      },
    });

    if (!dataset) {
      return res.json({ dataset: null });
    }

    return res.json({
      dataset: {
        id: dataset.id,
        marketId: dataset.marketId,
        week: dataset.week,
        tabId: dataset.tabId,
        category: dataset.category,
        columns: asStringArray(dataset.columns),
        rows: asStringMatrix(dataset.rows),
        fileName: dataset.fileName,
        sheetName: dataset.sheetName,
        location: dataset.location,
        uploadedBy: dataset.uploadedBy,
        updatedAt: dataset.updatedAt,
      },
    });
  } catch (error) {
    console.error("Get report error:", error);
    return res.status(500).json({ error: "Failed to load report data" });
  }
});

/** Base Weekly Summary seeds are carry-over rows, not a week the brand can open. */
function isBaseWeeklySummarySeed(row: {
  tabId: string;
  category: string;
  location: string | null;
}): boolean {
  return (
    row.tabId === "weekly-summary" &&
    (row.category.trim() === "base" ||
      (row.location ?? "").trim() === "base-summary-upload")
  );
}

/** Distinct weeks that have saved report data for a market (frontpage dropdown). */
reportsRouter.get("/weeks", async (req, res) => {
  try {
    const marketId = String(req.query.marketId ?? "").trim();
    if (!marketId) {
      return res.status(400).json({ error: "marketId is required" });
    }

    const rows = await prisma.reportDataset.findMany({
      where: { marketId },
      select: { week: true, tabId: true, category: true, location: true },
    });

    const weeks = [
      ...new Set(
        rows
          .filter((row) => !isBaseWeeklySummarySeed(row))
          .map((row) => row.week.trim())
          .filter((week) => isPeriodCode(week))
          .map((week) => week.toUpperCase()),
      ),
    ].sort((a, b) => b.localeCompare(a));

    return res.json({ weeks });
  } catch (error) {
    console.error("Get weeks error:", error);
    return res.status(500).json({ error: "Failed to load weeks" });
  }
});

const COMMISSION_SETTINGS_KEY = (marketId: string) =>
  `commission-calc:${marketId.trim().toLowerCase()}`;

function isWeekCode(value: string): boolean {
  return /^\d{4}W\d{1,2}$/i.test(value.trim());
}

/** Weekly YYYYWww or monthly YYYYMM period codes. */
function isPeriodCode(value: string): boolean {
  const code = value.trim().toUpperCase();
  if (/^\d{4}W\d{2}$/i.test(code)) return true;
  if (!/^\d{6}$/.test(code)) return false;
  const month = Number(code.slice(4));
  return month >= 1 && month <= 12;
}

function asPercent(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return n;
}

function sanitizeStoredCommissionSettings(raw: unknown): {
  versions: Array<{
    effectiveFromWeek: string | null;
    profile: Record<string, unknown>;
  }>;
} | null {
  if (!raw || typeof raw !== "object") return null;
  const versionsRaw = (raw as { versions?: unknown }).versions;
  if (!Array.isArray(versionsRaw) || versionsRaw.length === 0 || versionsRaw.length > 50) {
    return null;
  }
  const versions = [];
  for (const item of versionsRaw) {
    if (!item || typeof item !== "object") return null;
    const row = item as { effectiveFromWeek?: unknown; profile?: unknown };
    const weekValue = row.effectiveFromWeek;
    const effectiveFromWeek =
      weekValue == null || String(weekValue).trim() === ""
        ? null
        : String(weekValue).trim().toUpperCase();
    if (effectiveFromWeek && !isWeekCode(effectiveFromWeek)) return null;
    const profile = row.profile;
    if (!profile || typeof profile !== "object") return null;
    const source = profile as Record<string, unknown>;
    if (source.mode !== "flat" && source.mode !== "tiered") return null;
    if (
      source.totalProfitLoss !== "gross" &&
      source.totalProfitLoss !== "gross-recycle-cancel"
    ) {
      return null;
    }
    const flatPercent = asPercent(source.flatPercent);
    const deductionPercent = asPercent(source.deductionPercent);
    const minFinalNet = Number(source.minFinalNet);
    const minAp = Number(source.minAp);
    const tierMinFinalNet = Number(source.tierMinFinalNet);
    const tierMinAp = Number(source.tierMinAp);
    if (
      flatPercent == null ||
      deductionPercent == null ||
      !Number.isFinite(minFinalNet) ||
      minFinalNet < 0 ||
      !Number.isFinite(minAp) ||
      minAp < 0 ||
      !Number.isFinite(tierMinFinalNet) ||
      tierMinFinalNet < 0 ||
      !Number.isFinite(tierMinAp) ||
      tierMinAp < 0 ||
      !Array.isArray(source.tiers) ||
      source.tiers.length === 0 ||
      source.tiers.length > 8
    ) {
      return null;
    }
    const tiers = [];
    for (const tier of source.tiers) {
      if (!tier || typeof tier !== "object") return null;
      const band = tier as { minAp?: unknown; percent?: unknown };
      const bandAp = Number(band.minAp);
      const bandPercent = asPercent(band.percent);
      if (!Number.isFinite(bandAp) || bandAp < 0 || bandPercent == null) return null;
      tiers.push({ minAp: bandAp, percent: bandPercent });
    }
    versions.push({
      effectiveFromWeek,
      profile: {
        mode: source.mode,
        flatPercent,
        minFinalNet,
        minAp,
        tiers,
        tierMinFinalNet,
        tierMinAp,
        deductionPercent,
        totalProfitLoss: source.totalProfitLoss,
      },
    });
  }
  return { versions };
}

reportsRouter.get("/commission-settings", async (req, res) => {
  try {
    const marketId = String(req.query.marketId ?? "").trim();
    if (!marketId) {
      return res.status(400).json({ error: "marketId is required" });
    }
    const row = await prisma.appSetting.findUnique({
      where: { key: COMMISSION_SETTINGS_KEY(marketId) },
    });
    if (!row) return res.json({ settings: null });
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(row.value);
    } catch {
      parsed = null;
    }
    const settings = sanitizeStoredCommissionSettings(parsed);
    return res.json({ settings });
  } catch (error) {
    console.error("Get commission settings error:", error);
    return res.status(500).json({ error: "Failed to load commission settings" });
  }
});

reportsRouter.put(
  "/commission-settings",
  requirePermission("importExcel"),
  async (req, res) => {
    try {
      const marketId = String(req.body?.marketId ?? "").trim();
      if (!marketId) {
        return res.status(400).json({ error: "marketId is required" });
      }
      const settings = sanitizeStoredCommissionSettings(req.body?.settings);
      if (!settings) {
        return res.status(400).json({ error: "Invalid commission settings" });
      }
      await prisma.appSetting.upsert({
        where: { key: COMMISSION_SETTINGS_KEY(marketId) },
        create: {
          key: COMMISSION_SETTINGS_KEY(marketId),
          value: JSON.stringify(settings),
        },
        update: { value: JSON.stringify(settings) },
      });
      return res.json({ settings });
    } catch (error) {
      console.error("Save commission settings error:", error);
      return res.status(500).json({ error: "Failed to save commission settings" });
    }
  },
);

/** All weeks for one tab (e.g. Weekly Summary across every imported week). */
reportsRouter.get("/tab", async (req, res) => {
  try {
    const marketId = String(req.query.marketId ?? "").trim();
    const tabId = String(req.query.tabId ?? "").trim();

    if (!marketId || !tabId) {
      return res.status(400).json({ error: "marketId and tabId are required" });
    }

    const datasets = await prisma.reportDataset.findMany({
      where: { marketId, tabId },
      orderBy: [{ week: "asc" }, { category: "asc" }],
    });

    return res.json({
      datasets: datasets.map((dataset) => ({
        id: dataset.id,
        marketId: dataset.marketId,
        week: dataset.week,
        tabId: dataset.tabId,
        category: dataset.category,
        columns: asStringArray(dataset.columns),
        rows: asStringMatrix(dataset.rows),
        fileName: dataset.fileName,
        sheetName: dataset.sheetName,
        location: dataset.location,
        uploadedBy: dataset.uploadedBy,
        updatedAt: dataset.updatedAt,
      })),
    });
  } catch (error) {
    console.error("Get tab reports error:", error);
    return res.status(500).json({ error: "Failed to load tab datasets" });
  }
});

reportsRouter.delete("/all", requirePermission("importExcel"), async (req, res) => {
  try {
    const rejected = await rejectIfPasswordWrong(
      req.user?.userId,
      req.body?.password,
    );
    if (rejected) {
      return res.status(rejected.status).json({ error: rejected.error });
    }

    const result = await prisma.reportDataset.deleteMany();
    return res.json({ deleted: result.count });
  } catch (error) {
    console.error("Clear reports error:", error);
    return res.status(500).json({ error: "Failed to clear report data" });
  }
});

/** Only raw upload sources may be deleted directly. */
const RAW_UPLOAD_TAB_IDS = [
  "aff-raw-upload",
  "player-raw-upload",
  "system-comm-raw",
  "aff-su",
  "business-raw",
];

/** Tables derived from the raw sources — cleared when their sources are deleted. */
const DERIVED_TAB_IDS = [
  "week-detail",
  "paid-comm",
  "weekly-summary",
  "bad-aff",
  "adjustment-notes",
];

/**
 * Delete report data with password re-confirmation. Two scopes:
 *   - scope="tab":  delete one RAW UPLOAD table (tabId) for ONE week.
 *   - scope="week": delete ALL raw upload tables for one week.
 * In both cases the linked/derived tables (Week Detail, Weekly Summary, Paid
 * Comm, Bad Aff, Adjustment Notes) are also cleared for the affected week,
 * since they can no longer be computed once the source is gone.
 * A snapshot is recorded to History so the deletion can be restored.
 */
reportsRouter.post("/purge", requirePermission("importExcel"), async (req, res) => {
  try {
    const marketId = String(req.body?.marketId ?? "").trim();
    const scope = String(req.body?.scope ?? "").trim();
    const tabId = String(req.body?.tabId ?? "").trim();
    const week = String(req.body?.week ?? "").trim();
    const password = String(req.body?.password ?? "");

    if (!marketId) {
      return res.status(400).json({ error: "marketId is required" });
    }
    if (scope !== "tab" && scope !== "week") {
      return res.status(400).json({ error: "scope must be 'tab' or 'week'" });
    }
    if (scope === "tab" && !RAW_UPLOAD_TAB_IDS.includes(tabId)) {
      return res
        .status(400)
        .json({ error: "Only raw upload tables can be deleted" });
    }
    if (!week) {
      return res.status(400).json({ error: "week is required" });
    }
    const rejected = await rejectIfPasswordWrong(req.user?.userId, password);
    if (rejected) {
      return res.status(rejected.status).json({ error: rejected.error });
    }

    // Raw uploads to remove + the derived tables that depend on them (per week).
    const where =
      scope === "tab"
        ? { marketId, week, tabId: { in: [tabId, ...DERIVED_TAB_IDS] } }
        : {
            marketId,
            week,
            tabId: { in: [...RAW_UPLOAD_TAB_IDS, ...DERIVED_TAB_IDS] },
          };

    const datasets = await prisma.reportDataset.findMany({ where });
    if (datasets.length === 0) {
      return res.json({ deleted: 0, historyId: null });
    }

    const snapshotItems: HistorySnapshotItem[] = datasets.map((dataset) => ({
      week: dataset.week,
      tabId: dataset.tabId,
      category: dataset.category,
      columns: asStringArray(dataset.columns),
      rows: asStringMatrix(dataset.rows),
      fileName: dataset.fileName,
      sheetName: dataset.sheetName,
      location: dataset.location,
    }));

    const result = await prisma.reportDataset.deleteMany({ where });

    const label =
      scope === "tab"
        ? `Deleted raw table "${tabId}" (${week}) + linked tables`
        : `Deleted raw uploads for ${week} + linked tables`;

    const audit = await recordReportHistory({
      req,
      marketId,
      action: "clear",
      label,
      items: snapshotItems,
    });

    return res.json({ deleted: result.count, historyId: audit?.id ?? null });
  } catch (error) {
    console.error("Purge reports error:", error);
    return res.status(500).json({ error: "Failed to delete report data" });
  }
});

/** List audit snapshots for a market (newest first, paginated). */
reportsRouter.get("/history", async (req, res) => {
  try {
    const marketId = String(req.query.marketId ?? "").trim();
    const pageSize = Math.min(
      100,
      Math.max(1, Number(req.query.pageSize ?? req.query.limit ?? 20) || 20),
    );
    const page = Math.max(1, Number(req.query.page ?? 1) || 1);
    const skip = (page - 1) * pageSize;

    if (!marketId) {
      return res.status(400).json({ error: "marketId is required" });
    }

    const where = { marketId };
    const [total, rows] = await Promise.all([
      prisma.reportHistory.count({ where }),
      prisma.reportHistory.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
        select: {
          id: true,
          marketId: true,
          action: true,
          label: true,
          weeks: true,
          fileName: true,
          userId: true,
          userEmail: true,
          userName: true,
          itemCount: true,
          createdAt: true,
        },
      }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    return res.json({
      histories: rows,
      page,
      pageSize,
      total,
      totalPages,
    });
  } catch (error) {
    console.error("List history error:", error);
    return res.status(500).json({ error: "Failed to load history" });
  }
});

/** One history snapshot with dataset items (for restore). */
reportsRouter.get("/history/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "Invalid history id" });
    }

    const history = await prisma.reportHistory.findUnique({
      where: { id },
      include: {
        items: {
          select: {
            id: true,
            week: true,
            tabId: true,
            category: true,
            fileName: true,
            sheetName: true,
            location: true,
            columns: true,
            rows: true,
          },
        },
      },
    });

    if (!history) {
      return res.status(404).json({ error: "History not found" });
    }

    const { ipAddress: _ipAddress, userAgent: _userAgent, ...safeHistory } =
      history;

    return res.json({
      history: {
        ...safeHistory,
        items: history.items.map((item) => ({
          ...item,
          columns: asStringArray(item.columns),
          rows: asStringMatrix(item.rows),
          rowCount: asStringMatrix(item.rows).length,
        })),
      },
    });
  } catch (error) {
    console.error("Get history error:", error);
    return res.status(500).json({ error: "Failed to load history entry" });
  }
});

/** Restore datasets from a history snapshot and record a new audit entry. */
reportsRouter.post(
  "/history/:id/restore",
  requirePermission("importExcel"),
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(400).json({ error: "Invalid history id" });
      }

      const rejected = await rejectIfPasswordWrong(
        req.user?.userId,
        req.body?.password,
      );
      if (rejected) {
        return res.status(rejected.status).json({ error: rejected.error });
      }

      const history = await prisma.reportHistory.findUnique({
        where: { id },
        include: { items: true },
      });

      if (!history) {
        return res.status(404).json({ error: "History not found" });
      }

      if (history.items.length === 0) {
        return res.status(400).json({ error: "History has no snapshot items" });
      }

      const restored: HistorySnapshotItem[] = [];

      for (const item of history.items) {
        const columns = asStringArray(item.columns);
        const rows = asStringMatrix(item.rows);
        if (!item.tabId || columns.length === 0) continue;

        await prisma.reportDataset.upsert({
          where: {
            marketId_week_tabId_category: {
              marketId: history.marketId,
              week: item.week,
              tabId: item.tabId,
              category: item.category,
            },
          },
          create: {
            marketId: history.marketId,
            week: item.week,
            tabId: item.tabId,
            category: item.category,
            columns,
            rows,
            fileName: item.fileName,
            sheetName: item.sheetName,
            location: item.location,
            uploadedBy: req.user?.userId ?? null,
          },
          update: {
            columns,
            rows,
            fileName: item.fileName,
            sheetName: item.sheetName,
            location: item.location,
            uploadedBy: req.user?.userId ?? null,
          },
        });

        restored.push({
          week: item.week,
          tabId: item.tabId,
          category: item.category,
          columns,
          rows,
          fileName: item.fileName,
          sheetName: item.sheetName,
          location: item.location,
        });
      }

      const audit = await recordReportHistory({
        req,
        marketId: history.marketId,
        action: "restore",
        label: `Restored history #${history.id}: ${history.label}`,
        fileName: history.fileName,
        items: restored,
      });

      return res.json({
        restored: restored.length,
        historyId: audit?.id ?? null,
      });
    } catch (error) {
      console.error("Restore history error:", error);
      return res.status(500).json({ error: "Failed to restore history" });
    }
  },
);

reportsRouter.put("/", requirePermission("importExcel"), async (req, res) => {
  try {
    const body = req.body as SaveBody;
    const marketId = String(body.marketId ?? "").trim();
    const week = String(body.week ?? "").trim();
    const tabId = String(body.tabId ?? "").trim();
    const category = String(body.category ?? "").trim();
    const columns = asStringArray(body.columns);
    const rows = asStringMatrix(body.rows);

    if (!marketId || !week || !tabId) {
      return res.status(400).json({
        error: "marketId, week, and tabId are required",
      });
    }

    if (columns.length === 0) {
      return res.status(400).json({ error: "columns are required" });
    }

    const dataset = await prisma.reportDataset.upsert({
      where: {
        marketId_week_tabId_category: {
          marketId,
          week,
          tabId,
          category,
        },
      },
      create: {
        marketId,
        week,
        tabId,
        category,
        columns,
        rows,
        fileName: body.fileName ?? null,
        sheetName: body.sheetName ?? null,
        location: body.location ?? null,
        uploadedBy: req.user?.userId ?? null,
      },
      update: {
        columns,
        rows,
        fileName: body.fileName ?? null,
        sheetName: body.sheetName ?? null,
        location: body.location ?? null,
        uploadedBy: req.user?.userId ?? null,
      },
    });

    const historyLabel =
      String(body.historyLabel ?? "").trim() ||
      `Saved ${tabId}${week ? ` (${week})` : ""}`;

    await recordReportHistory({
      req,
      marketId,
      action: "edit",
      label: historyLabel,
      fileName: body.fileName ?? null,
      items: [
        {
          week,
          tabId,
          category,
          columns,
          rows,
          fileName: body.fileName ?? null,
          sheetName: body.sheetName ?? null,
          location: body.location ?? null,
        },
      ],
    });

    return res.json({
      dataset: {
        id: dataset.id,
        marketId: dataset.marketId,
        week: dataset.week,
        tabId: dataset.tabId,
        category: dataset.category,
        columns: asStringArray(dataset.columns),
        rows: asStringMatrix(dataset.rows),
        fileName: dataset.fileName,
        sheetName: dataset.sheetName,
        location: dataset.location,
        uploadedBy: dataset.uploadedBy,
        updatedAt: dataset.updatedAt,
      },
    });
  } catch (error) {
    console.error("Save report error:", error);
    return res.status(500).json({ error: "Failed to save report data" });
  }
});

reportsRouter.put("/bulk", requirePermission("importExcel"), async (req, res) => {
  try {
    const marketId = String(req.body?.marketId ?? "").trim();
    const week = String(req.body?.week ?? "").trim();
    const fileName = (req.body?.fileName as string | null | undefined) ?? null;
    const historyLabel =
      String(req.body?.historyLabel ?? "").trim() ||
      `Bulk save${fileName ? `: ${fileName}` : ""}`;
    const historyAction =
      String(req.body?.historyAction ?? "").trim() === "edit" ? "edit" : "import";
    const items = Array.isArray(req.body?.items) ? req.body.items : [];

    if (!marketId || !week) {
      return res.status(400).json({ error: "marketId and week are required" });
    }

    const saved = [];
    const snapshotItems: HistorySnapshotItem[] = [];

    for (const item of items) {
      const tabId = String(item?.tabId ?? "").trim();
      const category = String(item?.category ?? "").trim();
      const itemWeek = String(item?.week ?? week).trim() || week;
      const columns = asStringArray(item?.columns);
      const rows = asStringMatrix(item?.rows);
      if (!tabId || columns.length === 0) continue;

      const dataset = await prisma.reportDataset.upsert({
        where: {
          marketId_week_tabId_category: {
            marketId,
            week: itemWeek,
            tabId,
            category,
          },
        },
        create: {
          marketId,
          week: itemWeek,
          tabId,
          category,
          columns,
          rows,
          fileName,
          sheetName: item?.sheetName ?? null,
          location: item?.location ?? null,
          uploadedBy: req.user?.userId ?? null,
        },
        update: {
          columns,
          rows,
          fileName,
          sheetName: item?.sheetName ?? null,
          location: item?.location ?? null,
          uploadedBy: req.user?.userId ?? null,
        },
      });

      // Base Week Detail replaces any computed week-detail for the same week.
      if (tabId === "week-detail" && category === "base") {
        await prisma.reportDataset.deleteMany({
          where: {
            marketId,
            week: itemWeek,
            tabId: "week-detail",
            category: "",
          },
        });
      }

      saved.push({
        tabId: dataset.tabId,
        category: dataset.category,
        week: dataset.week,
        rows: asStringMatrix(dataset.rows).length,
      });

      snapshotItems.push({
        week: itemWeek,
        tabId,
        category,
        columns,
        rows,
        fileName,
        sheetName: item?.sheetName ?? null,
        location: item?.location ?? null,
      });
    }

    let historyId: number | null = null;
    if (snapshotItems.length > 0) {
      try {
        const history = await recordReportHistory({
          req,
          marketId,
          action: historyAction,
          label: historyLabel,
          fileName,
          items: snapshotItems,
        });
        historyId = history?.id ?? null;
      } catch (historyError) {
        // Datasets already upserted — don't fail the import if audit history
        // cannot be stored (large snapshots / transient MySQL resets).
        console.error("Bulk save history warning:", historyError);
      }
    }

    return res.json({ saved, historyId });
  } catch (error) {
    console.error("Bulk save error:", error);
    return res.status(500).json({ error: "Failed to bulk save report data" });
  }
});