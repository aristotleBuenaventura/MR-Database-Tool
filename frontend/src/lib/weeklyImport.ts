import type { ReportTabId } from "../config/reports";
import {
  TAB_COLUMNS,
  WEEKLY_KPI_COLUMNS,
  periodCopy,
  weekDetailColumnsForMarket,
} from "../config/reports";
import type { CommissionProfile } from "./commissionSettings";
import {
  buildRawUploadColumns,
  getSheetHeaders,
  mapSheetToColumns,
  mapSheetPositional,
  remapRowsToColumns,
  unionColumnLayouts,
  type ParsedWorkbook,
} from "./excel";

export type SourceTabId = Exclude<
  ReportTabId,
  "week-detail" | "weekly-summary" | "history" | "adjustment-notes"
>;

export const SOURCE_SHEET_ALIASES: {
  match: RegExp;
  tabId: SourceTabId | "week-detail" | "weekly-summary";
}[] = [
  { match: /^aff\s*raww?$/i, tabId: "aff-raw-upload" },
  { match: /^player\s*raww?$/i, tabId: "player-raw-upload" },
  { match: /^system\s*comm/i, tabId: "system-comm-raw" },
  { match: /^paid\s*comm/i, tabId: "paid-comm" },
  { match: /^aff\s*su$/i, tabId: "aff-su" },
  { match: /^business\s*raw/i, tabId: "business-raw" },
  { match: /^(weekly|monthly)\s*summary$/i, tabId: "weekly-summary" },
  /** Guideline per-week tab, e.g. 2026W26 */
  { match: /^\d{4}W\d{2}$/i, tabId: "week-detail" },
];

export function detectSheetTab(
  sheetName: string,
): SourceTabId | "week-detail" | "weekly-summary" | null {
  for (const alias of SOURCE_SHEET_ALIASES) {
    if (alias.match.test(sheetName.trim())) return alias.tabId;
  }
  return null;
}

/**
 * Uploadable source tabs (guideline Aff RawW / Player RawW / System Comm / Aff SU / Business Raw).
 * Week Detail, Paid Comm, and Weekly Summary are always computed — never uploaded.
 */
export const RAW_UPLOAD_TAB_IDS = [
  "aff-raw-upload",
  "player-raw-upload",
  "system-comm-raw",
  "aff-su",
  "business-raw",
] as const;

export type RawUploadTabId = (typeof RAW_UPLOAD_TAB_IDS)[number];

export const WEEKLY_UPLOAD_TAB_IDS = new Set<string>(RAW_UPLOAD_TAB_IDS);

export function isRawUploadTabId(tabId: string): tabId is RawUploadTabId {
  return WEEKLY_UPLOAD_TAB_IDS.has(tabId);
}

export function isWeeklyUploadSheet(tabId: string): boolean {
  return WEEKLY_UPLOAD_TAB_IDS.has(tabId);
}

export function listWeekSheets(sheetNames: string[]): string[] {
  return sheetNames.filter((name) => /^\d{4}W\d{2}$/i.test(name.trim()));
}

export type SheetOption = {
  sheetName: string;
  tabId: SourceTabId | "week-detail" | "weekly-summary" | "unknown";
  recognized: boolean;
};

export function listImportableSheets(sheetNames: string[]): SheetOption[] {
  return sheetNames.map((sheetName) => {
    const tabId = detectSheetTab(sheetName);
    return {
      sheetName,
      tabId: tabId ?? "unknown",
      recognized: Boolean(tabId),
    };
  });
}

export type ImportedSources = Partial<Record<ReportTabId, string[][]>> & {
  detectedSheets: { sheetName: string; tabId: string }[];
  /** Unfiltered Aff SU — needed so weekly detail can include all affiliates. */
  affSuAll: string[][];
  /** Actual column layouts from the file (game metrics are dynamic). */
  sourceColumns: Partial<Record<RawUploadTabId, string[]>>;
};

function weekKeyColumnIndex(columns: string[]): number {
  const exact = columns.findIndex((column) =>
    /^(month|week|date)$/i.test(column.trim()),
  );
  if (exact >= 0) return exact;
  return columns.findIndex((column) => /month|week|date/i.test(column));
}

export function sortWeekCodes(weeks: string[]): string[] {
  return [...weeks]
    .map((week) => normalizeWeekCode(week))
    .filter((week) => isValidWeekCode(week))
    .sort((a, b) => a.localeCompare(b));
}

/** Collect YYYYWww codes from Month/Week/Date column values. */
export function extractWeekCodes(columns: string[], rows: string[][]): string[] {
  const keyIndex = weekKeyColumnIndex(columns);
  if (keyIndex < 0) return [];

  const weeks = new Set<string>();
  for (const row of rows) {
    const raw = String(row[keyIndex] ?? "").trim();
    if (!isValidWeekCode(raw)) continue;
    weeks.add(normalizeWeekCode(raw));
  }
  return sortWeekCodes([...weeks]);
}

/** Keep only rows that belong to the selected week code (e.g. 2026W25). */
export function filterRowsForWeek(
  columns: string[],
  rows: string[][],
  week: string,
): string[][] {
  const weekNorm = normalizeWeekCode(week);
  const keyIndex = weekKeyColumnIndex(columns);
  if (keyIndex < 0) return rows;

  return rows.filter(
    (row) => String(row[keyIndex] ?? "").trim().toUpperCase() === weekNorm,
  );
}

/** Sort source rows by week code (then keep stable order within a week). */
export function sortRowsByWeek(columns: string[], rows: string[][]): string[][] {
  const keyIndex = weekKeyColumnIndex(columns);
  if (keyIndex < 0) return rows;

  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const wa = String(a.row[keyIndex] ?? "").trim().toUpperCase();
      const wb = String(b.row[keyIndex] ?? "").trim().toUpperCase();
      const cmp = wa.localeCompare(wb);
      return cmp !== 0 ? cmp : a.index - b.index;
    })
    .map((item) => item.row);
}

/**
 * Split imported source rows into per-week buckets.
 * - Aff SU is copied to every target week (shared signup list).
 * - Sheets with no week codes are assigned to `fallbackWeek` only.
 */
export function splitRowsByWeek(
  tabId: RawUploadTabId,
  rows: string[][],
  targetWeeks: string[],
  fallbackWeek: string,
  columns: string[] = TAB_COLUMNS[tabId],
): Map<string, string[][]> {
  const map = new Map<string, string[][]>();
  const sorted = sortRowsByWeek(columns, rows);

  if (tabId === "aff-su") {
    for (const week of targetWeeks) map.set(week, sorted);
    return map;
  }

  const codes = extractWeekCodes(columns, sorted);
  if (codes.length === 0) {
    map.set(normalizeWeekCode(fallbackWeek), sorted);
    return map;
  }

  for (const week of targetWeeks) {
    map.set(week, filterRowsForWeek(columns, sorted, week));
  }
  return map;
}

/**
 * Read selected workbook sheets (all weeks kept, sorted by week column).
 * - `forceTabId` = map every selected sheet to that raw tab (per-tab upload)
 */
export function importAllSourceSheets(
  workbook: ParsedWorkbook,
  selectedSheetNames: string[],
  forceTabId?: RawUploadTabId,
): ImportedSources {
  const detectedSheets: { sheetName: string; tabId: string }[] = [];
  const result: ImportedSources = { detectedSheets, affSuAll: [], sourceColumns: {} };
  const selected = new Set(selectedSheetNames.map((name) => name.trim()));

  const isDynamicRawTab = (tabId: RawUploadTabId) =>
    tabId === "aff-raw-upload" || tabId === "player-raw-upload";

  for (const sheetName of workbook.sheetNames) {
    if (!selected.has(sheetName.trim())) continue;

    const detected = detectSheetTab(sheetName);
    const tabId = forceTabId ?? detected;
    if (!tabId) continue;

    // Legacy week-code / summary sheets are never imported as upload sources.
    if (tabId === "week-detail" || tabId === "weekly-summary" || tabId === "paid-comm") {
      continue;
    }
    if (!isRawUploadTabId(tabId)) continue;

    const coreColumns = TAB_COLUMNS[tabId];
    const columns = isDynamicRawTab(tabId)
      ? buildRawUploadColumns(
          coreColumns,
          getSheetHeaders(workbook.workbook, sheetName),
        )
      : [...coreColumns];
    const mapped = mapSheetToColumns(workbook.workbook, sheetName, columns);
    let sortedRows = sortRowsByWeek(columns, mapped.rows);
    let layout = columns;

    const existingLayout = result.sourceColumns[tabId];
    const existingRows = result[tabId];
    if (existingLayout && existingRows && existingLayout.length > 0) {
      layout = unionColumnLayouts(existingLayout, columns);
      const remappedExisting = remapRowsToColumns(existingRows, existingLayout, layout);
      const remappedNext = remapRowsToColumns(sortedRows, columns, layout);
      sortedRows = sortRowsByWeek(layout, [...remappedExisting, ...remappedNext]);
    }

    if (tabId === "aff-su") {
      result.affSuAll = sortedRows;
    }

    result[tabId] = sortedRows;
    result.sourceColumns[tabId] = layout;
    detectedSheets.push({ sheetName, tabId });
  }

  return result;
}

/** Weeks discovered in imported raw sheets (excluding Aff SU). */
export function detectWeeksFromImported(
  imported: ImportedSources,
  fallbackWeek?: string,
): string[] {
  const weeks = new Set<string>();

  for (const tabId of RAW_UPLOAD_TAB_IDS) {
    if (tabId === "aff-su") continue;
    const rows = imported[tabId];
    if (!rows?.length) continue;
    for (const week of extractWeekCodes(
      imported.sourceColumns[tabId] ?? TAB_COLUMNS[tabId],
      rows,
    )) {
      weeks.add(week);
    }
  }

  const fallback = fallbackWeek?.trim() ? normalizeWeekCode(fallbackWeek) : "";
  if (weeks.size === 0 && fallback && isValidWeekCode(fallback)) {
    weeks.add(fallback);
  }

  return sortWeekCodes([...weeks]);
}

/**
 * Pick the primary week to import from raw sheets.
 * Uses the week with the most Month/Week rows; ties go to the latest week.
 */
export function pickPrimaryWeekFromImported(
  imported: ImportedSources,
  fallbackWeek?: string,
  marketId?: string | null,
): string {
  const counts = new Map<string, number>();

  for (const tabId of RAW_UPLOAD_TAB_IDS) {
    if (tabId === "aff-su") continue;
    const rows = imported[tabId];
    if (!rows?.length) continue;
    const columns = imported.sourceColumns[tabId] ?? TAB_COLUMNS[tabId];
    const keyIndex = weekKeyColumnIndex(columns);
    if (keyIndex < 0) continue;
    for (const row of rows) {
      const code = normalizeWeekCode(String(row[keyIndex] ?? ""));
      if (!isValidWeekCode(code)) continue;
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }
  }

  if (counts.size === 0) {
    const fallback = fallbackWeek?.trim() ? normalizeWeekCode(fallbackWeek) : "";
    if (fallback && isValidWeekCode(fallback)) return fallback;
    const words = periodCopy(marketId);
    throw new Error(
      `Could not detect ${words.week} from the file. ${words.periodKey} column must contain a code like 2026W32.`,
    );
  }

  let best = "";
  let bestCount = -1;
  for (const [code, count] of [...counts.entries()].sort((a, b) =>
    b[0].localeCompare(a[0]),
  )) {
    if (count > bestCount) {
      best = code;
      bestCount = count;
    }
  }
  return best;
}

export function previousWeekCode(week: string): string | null {
  const match = /^(\d{4})W(\d{2})$/i.exec(week.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const weekNo = Number(match[2]);
  if (weekNo > 1) {
    return `${year}W${String(weekNo - 1).padStart(2, "0")}`;
  }
  return `${year - 1}W52`;
}

export function nextWeekCode(week: string): string | null {
  const match = /^(\d{4})W(\d{2})$/i.exec(week.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const weekNo = Number(match[2]);
  if (weekNo < 52) {
    return `${year}W${String(weekNo + 1).padStart(2, "0")}`;
  }
  // ISO years can have 53 weeks; treat W53 → next year W01, W52 → W53 if needed.
  if (weekNo === 52) {
    return `${year}W53`;
  }
  return `${year + 1}W01`;
}

/** Normalize typed week codes like "2026w28" / "2026 W28" → "2026W28". */
export function normalizeWeekCode(value: string): string {
  const raw = value.trim().toUpperCase().replace(/\s+/g, "");
  const match = /^(\d{4})W(\d{1,2})$/.exec(raw);
  if (!match) return raw;
  return `${match[1]}W${String(Number(match[2])).padStart(2, "0")}`;
}

export function isValidWeekCode(value: string): boolean {
  return /^\d{4}W\d{2}$/.test(normalizeWeekCode(value));
}

export type BaseWeekDetailImport = {
  week: string;
  sheetName: string;
  /** Rows mapped to WEEKLY_DETAIL_COLUMNS (Week column stamped). */
  rows: string[][];
  /** Uploaded Next Week NCF values (same order as rows) — seed for W+1 carry-over. */
  uploadedNextNcf: string[];
  matchedColumns: string[];
  missingColumns: string[];
};

/** Pull YYYYWww from a file or sheet name (e.g. "2026W32_week-detail.xlsx"). */
export function detectWeekCodeFromName(name: string): string | null {
  const match = String(name ?? "").match(/(\d{4})\s*W\s*(\d{1,2})/i);
  if (!match) return null;
  const code = normalizeWeekCode(`${match[1]}W${match[2]}`);
  return isValidWeekCode(code) ? code : null;
}

/**
 * Pick the best sheet for a base Week Detail upload.
 * Prefers a sheet named like 2026W33 (latest when several), then "week detail",
 * else first sheet. Uses file/sheet name hints when provided.
 */
export function pickBaseWeekDetailSheet(
  sheetNames: string[],
  preferredWeek?: string,
  fileName?: string,
): string | null {
  if (sheetNames.length === 0) return null;
  const preferred = preferredWeek
    ? normalizeWeekCode(preferredWeek)
    : detectWeekCodeFromName(fileName ?? "") ?? "";
  if (preferred) {
    const exact = sheetNames.find(
      (name) => normalizeWeekCode(name.trim()) === preferred,
    );
    if (exact) return exact;
  }
  const weekSheets = sheetNames
    .map((name) => ({ name, code: normalizeWeekCode(name.trim()) }))
    .filter((item) => isValidWeekCode(item.code))
    .sort((a, b) => b.code.localeCompare(a.code));
  if (weekSheets.length > 0) {
    if (preferred) {
      const match = weekSheets.find((item) => item.code === preferred);
      if (match) return match.name;
    }
    return weekSheets[0]!.name;
  }
  const labeled = sheetNames.find((name) =>
    /(week|month)\s*detail/i.test(name.trim()),
  );
  if (labeled) return labeled;
  return sheetNames[0] ?? null;
}

/**
 * Detect YYYYWww from row data, file/sheet names, or an optional hint.
 * When the sheet tab and Week column disagree, the unanimous Week column
 * wins (stale tab names are common). An explicit week in the filename still
 * wins over row data when they disagree.
 */
export function detectBaseWeekCode(
  sheetName: string,
  columns: string[],
  rows: string[][],
  preferredWeek?: string,
  fileName?: string,
  marketId?: string | null,
): string {
  const preferred = preferredWeek ? normalizeWeekCode(preferredWeek) : "";
  if (preferred && isValidWeekCode(preferred)) return preferred;

  const fromSheet = normalizeWeekCode(sheetName.trim());
  const sheetWeek = isValidWeekCode(fromSheet) ? fromSheet : null;

  const fromFile = detectWeekCodeFromName(fileName ?? "");
  const fileWeek = fromFile ?? null;

  const fromRows = extractWeekCodes(columns, rows);
  const rowWeek =
    fromRows.length === 1
      ? fromRows[0]!
      : fromRows.length > 1
        ? fromRows[fromRows.length - 1]!
        : null;

  // Renamed file (e.g. 2026W32.xlsx) beats stale Week-column values.
  if (fileWeek && rowWeek && fileWeek !== rowWeek) return fileWeek;

  // Unanimous Week column beats a stale sheet tab (e.g. tab "2026W31", rows "2026W32").
  if (rowWeek && sheetWeek && rowWeek !== sheetWeek) return rowWeek;

  if (rowWeek) return rowWeek;
  if (fileWeek) return fileWeek;
  if (sheetWeek) return sheetWeek;

  const words = periodCopy(marketId);
  throw new Error(
    `Could not detect ${words.week} from sheet "${sheetName}". Rename the sheet or file to a code like 2026W33 or include a ${words.Week} column.`,
  );
}

/**
 * Map a workbook sheet into Week Detail columns for use as a carry-over base.
 * Week is auto-detected from the sheet name or Week column when omitted.
 */
export function importBaseWeekDetailSheet(
  workbook: ParsedWorkbook,
  week?: string,
  sheetName?: string,
  fileName?: string,
  marketId?: string | null,
  profile?: CommissionProfile | null,
): BaseWeekDetailImport {
  const words = periodCopy(marketId);
  const preferred = week?.trim() ? normalizeWeekCode(week) : "";
  if (preferred && !isValidWeekCode(preferred)) {
    throw new Error(
      `Invalid ${words.week} code "${week}". Use a code like 2026W33.`,
    );
  }

  const resolvedSheet =
    sheetName?.trim() ||
    pickBaseWeekDetailSheet(
      workbook.sheetNames,
      preferred || undefined,
      fileName,
    );
  if (!resolvedSheet) {
    throw new Error("No sheets found in this file.");
  }

  const columns = weekDetailColumnsForMarket(marketId, profile?.totalProfitLoss);
  let mapped = mapSheetToColumns(workbook.workbook, resolvedSheet, columns);
  // Week Detail exports often match column order even when headers differ slightly.
  // If header matching failed for most fields, fall back to positional mapping.
  if (
    mapped.missingColumns.length >= Math.ceil(columns.length * 0.4) &&
    mapped.rows.length > 0
  ) {
    const positional = mapSheetPositional(
      workbook.workbook,
      resolvedSheet,
      columns.length,
    );
    if (positional.rows.length > 0) {
      const userIndex = columns.indexOf("Affiliate Username");
      const hasUsers = positional.rows.some(
        (row) => String(row[userIndex] ?? "").trim().length > 0,
      );
      if (hasUsers) {
        mapped = {
          rows: positional.rows,
          matchedColumns: [...columns],
          missingColumns: [],
          headerRowIndex: positional.headerRowIndex,
        };
      }
    }
  }
  if (mapped.rows.length === 0) {
    throw new Error(
      `No data rows found in sheet "${resolvedSheet}". Check headers match ${words.detail}.`,
    );
  }

  const userIndex = columns.indexOf("Affiliate Username");
  const weekIndex = Math.max(columns.indexOf("Week"), columns.indexOf("Month"));
  const nextNcfIndex = Math.max(
    columns.indexOf("Next Week Negative Carry Over"),
    columns.indexOf("Next Month Negative Carry Over"),
  );

  if (userIndex < 0) {
    throw new Error(
      `${words.detail} columns are misconfigured (Affiliate Username missing).`,
    );
  }

  const withUsernames = mapped.rows.filter(
    (row) => String(row[userIndex] ?? "").trim().length > 0,
  );
  if (withUsernames.length === 0) {
    throw new Error(
      `Sheet "${resolvedSheet}" has no Affiliate Username values. Upload a ${words.detail} export.`,
    );
  }

  const weekCode = detectBaseWeekCode(
    resolvedSheet,
    columns,
    withUsernames,
    preferred || undefined,
    fileName,
    marketId,
  );

  const uploadedNextNcf = withUsernames.map((row) =>
    nextNcfIndex >= 0 ? String(row[nextNcfIndex] ?? "").trim() : "",
  );

  const stamped = withUsernames.map((row) => {
    const next = [...row];
    while (next.length < columns.length) next.push("");
    if (weekIndex >= 0) next[weekIndex] = weekCode;
    return next;
  });

  return {
    week: weekCode,
    sheetName: resolvedSheet,
    rows: stamped,
    uploadedNextNcf,
    matchedColumns: mapped.matchedColumns,
    missingColumns: mapped.missingColumns,
  };
}

export type BaseWeeklySummaryImport = {
  sheetName: string;
  rowsByWeek: Map<string, string[]>;
  weeks: string[];
  matchedColumns: string[];
  missingColumns: string[];
};

/** Pick the Weekly Summary sheet from a base KPI workbook. */
export function pickBaseWeeklySummarySheet(sheetNames: string[]): string | null {
  if (sheetNames.length === 0) return null;
  const labeled = sheetNames.find((name) =>
    /(weekly|monthly)\s*summary/i.test(name.trim()),
  );
  if (labeled) return labeled;
  return sheetNames[0] ?? null;
}

/** Normalize uploaded base Weekly Summary rows (stamp Month, pad columns). */
export function finalizeBaseWeeklySummaryRows(rows: string[][]): string[][] {
  const columns = [...WEEKLY_KPI_COLUMNS];
  const monthIndex = columns.indexOf("Month");
  return rows
    .map((row) => {
      const next = [...row];
      while (next.length < columns.length) next.push("");
      if (monthIndex >= 0) {
        const week = normalizeWeekCode(String(next[monthIndex] ?? ""));
        if (week) next[monthIndex] = week;
      }
      return next;
    })
    .filter((row) => {
      const week = normalizeWeekCode(String(row[monthIndex] ?? ""));
      return isValidWeekCode(week);
    });
}

/**
 * Map a workbook sheet into Weekly Summary KPI rows (one row per week).
 * Values are kept as-uploaded for Total Aff carry-over seeding.
 */
export function importBaseWeeklySummarySheet(
  workbook: ParsedWorkbook,
  sheetName?: string,
  marketId?: string | null,
): BaseWeeklySummaryImport {
  const words = periodCopy(marketId);
  const resolvedSheet =
    sheetName?.trim() || pickBaseWeeklySummarySheet(workbook.sheetNames);
  if (!resolvedSheet) {
    throw new Error("No sheets found in this file.");
  }

  const columns = [...WEEKLY_KPI_COLUMNS];
  let mapped = mapSheetToColumns(workbook.workbook, resolvedSheet, columns);
  if (
    mapped.missingColumns.length >= Math.ceil(columns.length * 0.35) &&
    mapped.rows.length > 0
  ) {
    const positional = mapSheetPositional(
      workbook.workbook,
      resolvedSheet,
      columns.length,
    );
    if (positional.rows.length > 0) {
      const monthIndex = columns.indexOf("Month");
      const hasWeeks = positional.rows.some((row) =>
        isValidWeekCode(normalizeWeekCode(String(row[monthIndex] ?? ""))),
      );
      if (hasWeeks) {
        mapped = {
          rows: positional.rows,
          matchedColumns: [...columns],
          missingColumns: [],
          headerRowIndex: positional.headerRowIndex,
        };
      }
    }
  }

  const finalized = finalizeBaseWeeklySummaryRows(mapped.rows);
  if (finalized.length === 0) {
    throw new Error(
      `No ${words.weekly} rows found in sheet "${resolvedSheet}". Check the Month column uses a code like 2026W33.`,
    );
  }

  const rowsByWeek = new Map<string, string[]>();
  const monthIndex = columns.indexOf("Month");
  for (const row of finalized) {
    const week = normalizeWeekCode(String(row[monthIndex] ?? ""));
    if (!isValidWeekCode(week)) continue;
    rowsByWeek.set(week, row);
  }

  const weeks = [...rowsByWeek.keys()].sort((a, b) => a.localeCompare(b));
  if (weeks.length === 0) {
    throw new Error(
      `Sheet "${resolvedSheet}" has no valid Month / ${words.week} codes (for example 2026W33).`,
    );
  }

  return {
    sheetName: resolvedSheet,
    rowsByWeek,
    weeks,
    matchedColumns: mapped.matchedColumns,
    missingColumns: mapped.missingColumns,
  };
}
