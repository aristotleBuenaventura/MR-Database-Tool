/**
 * One-off: seed base Monthly Summary from the base Excel, then recompute 202610
 * New Sign Up / Total Aff / Dormant Aff with the monthly Aff SU filter.
 */
import { createRequire } from "node:module";
import {
  BASE_WEEK_DETAIL_CATEGORY,
  computeWeeklyKpi,
  readBaseWeeklySummarySeed,
  resolvePrevTotalAffForWeek,
} from "../src/lib/weeklyCompute.ts";
import { WEEKLY_KPI_COLUMNS } from "../src/config/reports.ts";
import { importBaseWeeklySummarySheet } from "../src/lib/weeklyImport.ts";
import { readFileSync } from "node:fs";

const requireFrontend = createRequire(
  "c:\\Users\\aris2\\Documents\\MR-Database-Tool\\frontend\\package.json",
);
const requireBackend = createRequire(
  "c:\\Users\\aris2\\Documents\\MR-Database-Tool\\backend\\package.json",
);
const XLSX = requireFrontend("xlsx") as typeof import("xlsx");
const mariadb = requireBackend("mariadb") as {
  createConnection: (opts: Record<string, unknown>) => Promise<{
    query: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
    beginTransaction: () => Promise<void>;
    commit: () => Promise<void>;
    rollback: () => Promise<void>;
    end: () => Promise<void>;
  }>;
};

const MARKET = "m1-bdt-monthly";
const MONTH = "202610";
const BASE_FILE =
  String.raw`c:\Users\aris2\Downloads\Telegram Desktop\M1 BDT Monthly Base File 202609.xlsx`;

function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

async function loadTab(
  conn: Awaited<ReturnType<typeof mariadb.createConnection>>,
  week: string,
  tabId: string,
  category = "",
) {
  const rows = await conn.query(
    `SELECT columns, \`rows\`, file_name, location, category
     FROM report_datasets
     WHERE market_id=? AND week=? AND tab_id=? AND category=?
     LIMIT 1`,
    [MARKET, week, tabId, category],
  );
  if (!rows[0]) {
    const any = await conn.query(
      `SELECT columns, \`rows\`, file_name, location, category
       FROM report_datasets
       WHERE market_id=? AND week=? AND tab_id=?
       ORDER BY CASE WHEN category='' THEN 0 WHEN category='base' THEN 1 ELSE 2 END
       LIMIT 1`,
      [MARKET, week, tabId],
    );
    if (!any[0]) return null;
    return {
      columns: parseJson<string[]>(any[0].columns, []),
      rows: parseJson<string[][]>(any[0].rows, []),
      file_name: any[0].file_name == null ? null : String(any[0].file_name),
      location: any[0].location == null ? null : String(any[0].location),
      category: String(any[0].category ?? ""),
    };
  }
  return {
    columns: parseJson<string[]>(rows[0].columns, []),
    rows: parseJson<string[][]>(rows[0].rows, []),
    file_name: rows[0].file_name == null ? null : String(rows[0].file_name),
    location: rows[0].location == null ? null : String(rows[0].location),
    category: String(rows[0].category ?? ""),
  };
}

async function upsertDataset(
  conn: Awaited<ReturnType<typeof mariadb.createConnection>>,
  week: string,
  tabId: string,
  category: string,
  columns: string[],
  rows: string[][],
  fileName: string,
  location: string | null,
) {
  await conn.query(
    `INSERT INTO report_datasets
      (market_id, week, tab_id, category, columns, \`rows\`, file_name, sheet_name, location, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3), NOW(3))
     ON DUPLICATE KEY UPDATE
       columns=VALUES(columns),
       \`rows\`=VALUES(\`rows\`),
       file_name=VALUES(file_name),
       sheet_name=VALUES(sheet_name),
       location=VALUES(location),
       updated_at=NOW(3)`,
    [
      MARKET,
      week,
      tabId,
      category,
      JSON.stringify(columns),
      JSON.stringify(rows),
      fileName,
      week,
      location,
    ],
  );
}

const conn = await mariadb.createConnection({
  host: "127.0.0.1",
  port: 3306,
  user: "root",
  password: "password",
  database: "mr_database_tool",
  allowPublicKeyRetrieval: true,
  ssl: false,
  // large summary history
});

try {
  const buffer = readFileSync(BASE_FILE);
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const parsed = {
    fileName: "M1 BDT Monthly Base File 202609.xlsx",
    sheetNames: workbook.SheetNames,
    workbook,
  };
  const imported = importBaseWeeklySummarySheet(parsed, undefined, MARKET);
  console.log("base summary weeks", imported.weeks.length, "last", imported.weeks.at(-1));
  const { seedWeek, seedTotalAff } = readBaseWeeklySummarySeed(imported.rowsByWeek);
  console.log({ seedWeek, seedTotalAff });

  await conn.beginTransaction();
  for (const week of imported.weeks) {
    const row = imported.rowsByWeek.get(week)!;
    await upsertDataset(
      conn,
      week,
      "weekly-summary",
      BASE_WEEK_DETAIL_CATEGORY,
      [...WEEKLY_KPI_COLUMNS],
      [row],
      "M1 BDT Monthly Base File 202609.xlsx",
      "base-upload",
    );
  }

  const aff = await loadTab(conn, MONTH, "aff-raw-upload");
  const affSu = await loadTab(conn, MONTH, "aff-su");
  const biz = await loadTab(conn, MONTH, "business-raw");
  const paid = await loadTab(conn, MONTH, "paid-comm");
  const detail = await loadTab(conn, MONTH, "week-detail");
  if (!aff || !detail) {
    throw new Error("Missing 202610 Aff Raw or Month Detail");
  }

  const rowsByWeek = new Map<string, string[]>();
  for (const week of imported.weeks) {
    rowsByWeek.set(week, imported.rowsByWeek.get(week)!);
  }
  // also load any existing non-base 202610 if present for resolve
  const existingSummary = await loadTab(conn, MONTH, "weekly-summary", "");
  if (existingSummary?.rows[0]) {
    rowsByWeek.set(MONTH, existingSummary.rows[0]!);
  }

  const prevTotalAff = resolvePrevTotalAffForWeek(
    MONTH,
    rowsByWeek,
    seedWeek,
    seedTotalAff,
  );
  console.log({ prevTotalAff });

  const kpi = computeWeeklyKpi({
    week: MONTH,
    marketId: MARKET,
    sources: {
      "aff-raw-upload": aff.rows,
      "aff-su": affSu?.rows ?? [],
      "business-raw": biz?.rows ?? [],
    },
    paidComm: paid?.rows ?? [],
    weekDetail: detail.rows,
    prevTotalAff: prevTotalAff ?? undefined,
    sourceColumns: {
      "aff-raw-upload": aff.columns,
    },
  });

  console.log("recomputed 202610 summary head", {
    month: kpi[0],
    newSignUp: kpi[1],
    totalAff: kpi[2],
    activeGe5: kpi[3],
    activeLt5: kpi[4],
    dormant: kpi[5],
    commission: kpi[WEEKLY_KPI_COLUMNS.indexOf("Commission")],
  });

  await upsertDataset(
    conn,
    MONTH,
    "weekly-summary",
    "",
    [...WEEKLY_KPI_COLUMNS],
    [kpi],
    existingSummary?.file_name ??
      "M1 BDT Monthly Online Website Source 202610.xlsx",
    null,
  );
  await conn.commit();
  console.log("Saved base summaries + repaired 202610 Monthly Summary");
} catch (error) {
  await conn.rollback();
  console.error(error);
  process.exit(1);
} finally {
  await conn.end();
}
