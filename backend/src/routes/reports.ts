import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import {
  asStringArray,
  asStringMatrix,
  recordReportHistory,
  type HistorySnapshotItem,
} from "../lib/history.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";

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

/** Distinct weeks that have saved data for a market (for the frontpage dropdown). */
reportsRouter.get("/weeks", async (req, res) => {
  try {
    const marketId = String(req.query.marketId ?? "").trim();
    if (!marketId) {
      return res.status(400).json({ error: "marketId is required" });
    }

    const rows = await prisma.reportDataset.findMany({
      where: { marketId },
      select: { week: true },
      distinct: ["week"],
    });

    const weeks = rows
      .map((row) => row.week.trim())
      .filter((week) => /^\d{4}W\d{2}$/i.test(week))
      .map((week) => week.toUpperCase())
      .sort((a, b) => b.localeCompare(a));

    return res.json({ weeks });
  } catch (error) {
    console.error("Get weeks error:", error);
    return res.status(500).json({ error: "Failed to load weeks" });
  }
});

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

reportsRouter.delete("/all", requirePermission("importExcel"), async (_req, res) => {
  try {
    const result = await prisma.reportDataset.deleteMany();
    return res.json({ deleted: result.count });
  } catch (error) {
    console.error("Clear reports error:", error);
    return res.status(500).json({ error: "Failed to clear report data" });
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
          ipAddress: true,
          userAgent: true,
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

    return res.json({
      history: {
        ...history,
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
      const history = await recordReportHistory({
        req,
        marketId,
        action: historyAction,
        label: historyLabel,
        fileName,
        items: snapshotItems,
      });
      historyId = history?.id ?? null;
    }

    return res.json({ saved, historyId });
  } catch (error) {
    console.error("Bulk save error:", error);
    return res.status(500).json({ error: "Failed to bulk save report data" });
  }
});