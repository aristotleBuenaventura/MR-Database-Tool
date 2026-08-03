import type { ReportTabId } from "../config/reports";
import { TAB_COLUMNS } from "../config/reports";
import { mapSheetToColumns, type ParsedWorkbook } from "./excel";

export type SourceTabId = Exclude<
  ReportTabId,
  "week-detail" | "weekly-summary" | "history"
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
  { match: /^weekly\s*summary$/i, tabId: "weekly-summary" },
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
): Map<string, string[][]> {
  const map = new Map<string, string[][]>();
  const columns = TAB_COLUMNS[tabId];
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
  const result: ImportedSources = { detectedSheets, affSuAll: [] };
  const selected = new Set(selectedSheetNames.map((name) => name.trim()));

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

    const columns = TAB_COLUMNS[tabId];
    const mapped = mapSheetToColumns(workbook.workbook, sheetName, columns);
    const sortedRows = sortRowsByWeek(columns, mapped.rows);

    if (tabId === "aff-su") {
      result.affSuAll = sortedRows;
    }

    const existing = result[tabId] ?? [];
    result[tabId] =
      existing.length > 0 ? sortRowsByWeek(columns, [...existing, ...sortedRows]) : sortedRows;
    detectedSheets.push({ sheetName, tabId });
  }

  return result;
}

/** Weeks discovered in imported raw sheets (excluding Aff SU). */
export function detectWeeksFromImported(
  imported: ImportedSources,
  fallbackWeek: string,
): string[] {
  const weeks = new Set<string>();

  for (const tabId of RAW_UPLOAD_TAB_IDS) {
    if (tabId === "aff-su") continue;
    const rows = imported[tabId];
    if (!rows?.length) continue;
    for (const week of extractWeekCodes(TAB_COLUMNS[tabId], rows)) {
      weeks.add(week);
    }
  }

  if (weeks.size === 0 && isValidWeekCode(fallbackWeek)) {
    weeks.add(normalizeWeekCode(fallbackWeek));
  }

  return sortWeekCodes([...weeks]);
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
