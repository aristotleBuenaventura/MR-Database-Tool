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
