import { Router } from "express";
import { prisma } from "../lib/prisma.js";
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
};

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

reportsRouter.get("/database", async (req, res) => {
  try {
    const marketId = String(req.query.marketId ?? "").trim();
    const week = String(req.query.week ?? "").trim();

    if (!marketId || !week) {
      return res.status(400).json({ error: "marketId and week are required" });
    }

    const datasets = await prisma.reportDataset.findMany({
      where: {
        marketId,
        week,
        tabId: "database",
      },
      orderBy: { category: "asc" },
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
    console.error("Get database reports error:", error);
    return res.status(500).json({ error: "Failed to load database datasets" });
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
    const items = Array.isArray(req.body?.items) ? req.body.items : [];

    if (!marketId || !week) {
      return res.status(400).json({ error: "marketId and week are required" });
    }

    const saved = [];

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
    }

    return res.json({ saved });
  } catch (error) {
    console.error("Bulk save error:", error);
    return res.status(500).json({ error: "Failed to bulk save report data" });
  }
});
