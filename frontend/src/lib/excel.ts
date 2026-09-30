import * as XLSX from "xlsx";

export type ParsedWorkbook = {
  fileName: string;
  sheetNames: string[];
  workbook: XLSX.WorkBook;
};

function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\n\r]+/g, " ")
    .replace(/[%&]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const CORE_METRIC_HEADERS = new Set([
  "total turnover",
  "total profit loss",
  "total stake",
  "bet count",
  "total number of bets",
]);

/** Per-game metrics from Aff Raw / Player Raw uploads — not core totals. */
export function isDynamicGameMetricHeader(header: string): boolean {
  const key = normalizeHeader(header);
  if (!key || CORE_METRIC_HEADERS.has(key)) return false;
  return (
    key.endsWith(" bet count") ||
    key.endsWith(" total stake") ||
    key.endsWith(" total turnover") ||
    key.endsWith(" total profit loss") ||
    key.endsWith(" total profit and loss")
  );
}

const GAME_METRIC_SUFFIX_RES = [
  /\s+bet\s+count$/i,
  /\s+total\s+stake$/i,
  /\s+total\s+turnover$/i,
  /\s+total\s+profit\s*(?:&|and)?\s*loss$/i,
];

/** Strip ` Bet Count` / ` Total Stake` / ` Total Turnover` / ` Total Profit&Loss` from a header. */
export function stripGameMetricSuffix(header: string): string | null {
  const label = String(header ?? "").trim();
  if (!label || !isDynamicGameMetricHeader(label)) return null;
  for (const re of GAME_METRIC_SUFFIX_RES) {
    if (re.test(label)) return label.replace(re, "").trim();
  }
  return null;
}

/** Unique game names from any per-game metric columns, in file order. */
export function collectGameNamesFromMetricColumns(
  columns: readonly string[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const header of columns) {
    const name = stripGameMetricSuffix(String(header ?? ""));
    const nameKey = name ? normalizeHeader(name) : "";
    if (!name || !nameKey || seen.has(nameKey)) continue;
    seen.add(nameKey);
    out.push(name);
  }
  return out;
}

/** Game names from Aff Raw / Player Raw `* Total Turnover` columns, in file order. */
export function collectGameNamesFromTurnoverColumns(
  columns: readonly string[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const header of columns) {
    const label = String(header ?? "").trim();
    if (!label || !isDynamicGameMetricHeader(label)) continue;
    const key = normalizeHeader(label);
    if (!key.endsWith(" total turnover")) continue;
    const name = stripGameMetricSuffix(label);
    const nameKey = name ? normalizeHeader(name) : "";
    if (!name || !nameKey || seen.has(nameKey)) continue;
    seen.add(nameKey);
    out.push(name);
  }
  return out;
}

export function collectDynamicGameMetricHeaders(sourceHeaders: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const header of sourceHeaders) {
    const label = String(header ?? "").trim();
    if (!label || !isDynamicGameMetricHeader(label)) continue;
    const key = normalizeHeader(label);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}

const OPTIONAL_RAW_TOTAL_COLUMNS = [
  "Total Recycle Amount",
  "Total Cancel Fee",
];

export function buildRawUploadColumns(
  coreColumns: readonly string[],
  sourceHeaders: string[],
): string[] {
  const coreKeys = new Set(coreColumns.map((column) => normalizeHeader(column)));
  const sourceKeys = new Set(
    sourceHeaders.map((header) => normalizeHeader(header)).filter(Boolean),
  );
  const optional = OPTIONAL_RAW_TOTAL_COLUMNS.filter((column) => {
    const key = normalizeHeader(column);
    return sourceKeys.has(key) && !coreKeys.has(key);
  });
  const layout = [...coreColumns];
  if (optional.length > 0) {
    const bonusAt = layout.findIndex(
      (column) => normalizeHeader(column) === "total bonus",
    );
    const insertAt = bonusAt >= 0 ? bonusAt + 1 : layout.length;
    layout.splice(insertAt, 0, ...optional);
  }
  const layoutKeys = new Set(layout.map((column) => normalizeHeader(column)));
  const games = collectDynamicGameMetricHeaders(sourceHeaders).filter(
    (header) => !layoutKeys.has(normalizeHeader(header)),
  );
  return [...layout, ...games];
}

export function unionColumnLayouts(base: string[], extra: string[]): string[] {
  const seen = new Set(base.map((column) => normalizeHeader(column)));
  const out = [...base];
  for (const column of extra) {
    const label = String(column ?? "").trim();
    if (!label) continue;
    const key = normalizeHeader(label);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}

export function remapRowsToColumns(
  rows: string[][],
  fromColumns: string[],
  toColumns: string[],
): string[][] {
  if (fromColumns.length === toColumns.length &&
      fromColumns.every((column, index) => normalizeHeader(column) === normalizeHeader(toColumns[index] ?? ""))) {
    return rows;
  }
  const fromIndex = new Map<string, number>();
  fromColumns.forEach((column, index) => {
    const key = normalizeHeader(column);
    if (key && !fromIndex.has(key)) fromIndex.set(key, index);
  });
  return rows.map((row) =>
    toColumns.map((column) => {
      const index = fromIndex.get(normalizeHeader(column));
      return index == null ? "" : String(row[index] ?? "");
    }),
  );
}

const HEADER_ALIASES: Record<string, string[]> = {
  month: ["month", "week"],
  start: ["start", "start date"],
  end: ["end", "end date"],
  "system commission": ["system commissioon", "system commission"],
  "final net": ["final net include ve carry over", "final net"],
  "last week ncf": ["last week negative carry over", "last week ncf"],
  "next week ncf": ["next week negative carry over", "next week ncf"],
  "last week negative carry over": ["last week negative carry over", "last week ncf"],
  "next week negative carry over": ["next week negative carry over", "next week ncf"],
  "number of first deposit": ["number of first deposits", "number of first deposit"],
  "ap to 0": ["ap to 0", "ap (to>0)", "ap(to>0)"],
  "ap qualified to 3000": [
    "ap qualified to 3000",
    "ap qualified (to>3000)",
    "ap qualified (to > 3000)",
    "ap qualified to 1000",
    "ap qualified (to>1000)",
    "ap qualified (to > 1000)",
  ],
  "aff raw bonus": ["aff raw bonus"],
  "player raw bonus": ["player raw bonus"],
  "su month": ["su month"],
  "total profit loss": ["total profit loss", "total profit loss"],
  "vip cash bonus": ["vip cash bonus", "total vip cash bonus"],
  "total vip cash bonus": ["total vip cash bonus", "vip cash bonus"],
  "total recycle amount": ["total recycle amount", "recycle amount"],
  "total cancel fee": ["total cancel fee", "cancel fee"],
  "recycle amount": ["recycle amount", "total recycle amount"],
  "cancel fee": ["cancel fee", "total cancel fee"],
  "final comm": ["final comm", "final commission"],
  "affiliate campaign": ["affiliate campaign", "affiliate campagin"],
};

function tokens(value: string): Set<string> {
  return new Set(normalizeHeader(value).split(" ").filter(Boolean));
}

function tokenScore(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  const union = ta.size + tb.size - inter;
  return union === 0 ? 0 : inter / union;
}

function resolveSourceIndex(
  targetHeader: string,
  sourceIndexByNormalized: Map<string, number>,
  sourceHeaders: string[],
): number {
  const key = normalizeHeader(targetHeader);
  if (!key) return -1;

  const direct = sourceIndexByNormalized.get(key);
  if (direct != null) return direct;

  for (const alias of HEADER_ALIASES[key] ?? []) {
    const found = sourceIndexByNormalized.get(normalizeHeader(alias));
    if (found != null) return found;
  }

  // Prefix / exact-ish match on normalized keys (avoid short false positives like "comm").
  let bestIndex = -1;
  let bestScore = 0;
  for (const [sourceKey, index] of sourceIndexByNormalized.entries()) {
    if (sourceKey === key) return index;

    let score = 0;
    if (sourceKey.startsWith(key) || key.startsWith(sourceKey)) {
      const shorter = Math.min(sourceKey.length, key.length);
      const longer = Math.max(sourceKey.length, key.length);
      // Require the shorter key to be meaningful and cover most of the longer one.
      if (shorter >= 4 && shorter / longer >= 0.7) score = shorter / longer;
    } else {
      score = tokenScore(key, sourceKey);
    }

    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  // High confidence only — never grab a weak substring match.
  if (bestScore >= 0.78) return bestIndex;

  // Last resort: unique source header that contains every target token.
  const targetTokens = [...tokens(targetHeader)];
  if (targetTokens.length >= 2) {
    const candidates = sourceHeaders
      .map((header, index) => ({ header, index, key: normalizeHeader(header) }))
      .filter(({ key: sourceKey }) => {
        if (!sourceKey) return false;
        const sourceTokens = tokens(sourceKey);
        return targetTokens.every((t) => sourceTokens.has(t));
      });
    if (candidates.length === 1) return candidates[0]!.index;
  }

  return -1;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function isMidnight(hours: number, minutes: number, seconds: number, ms: number): boolean {
  return hours === 0 && minutes === 0 && seconds === 0 && ms === 0;
}

function cellToString(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    const utcMidnight = isMidnight(
      value.getUTCHours(),
      value.getUTCMinutes(),
      value.getUTCSeconds(),
      value.getUTCMilliseconds(),
    );
    const localMidnight = isMidnight(
      value.getHours(),
      value.getMinutes(),
      value.getSeconds(),
      value.getMilliseconds(),
    );
    if (utcMidnight) {
      return `${value.getUTCFullYear()}-${pad2(value.getUTCMonth() + 1)}-${pad2(value.getUTCDate())}`;
    }
    if (localMidnight) {
      return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
    }
    return value.toISOString();
  }
  const text = String(value).trim();
  // Excel error / placeholder values should not wipe real columns visually as "data".
  if (/^#(N\/A|VALUE!|REF!|DIV\/0!|NAME\?|NULL!|NUM!)$/i.test(text)) return "";
  if (/^n\/a$/i.test(text)) return "";
  return String(value);
}

function isSpacerRow(row: string[]): boolean {
  const first = (row[0] ?? "").trim().toLowerCase();
  if (first === "space" || first === "spacer") return true;
  return row.every((cell) => cell.trim() === "");
}

/** Pick the densest header-like row in the first lines (Weekly Summary headers are not on row 0). */
export function findHeaderRowIndex(
  matrix: (string | number | boolean | Date | null)[][],
  maxScan = 12,
): number {
  let bestIndex = 0;
  let bestScore = -1;

  for (let i = 0; i < Math.min(maxScan, matrix.length); i++) {
    const row = matrix[i] ?? [];
    let textCells = 0;
    let numericCells = 0;
    for (const cell of row) {
      const raw = String(cell ?? "").trim();
      if (!raw) continue;
      if (/^[-+]?\d[\d,.]*%?$/.test(raw) || raw.startsWith("#")) numericCells += 1;
      else textCells += 1;
    }
    // Prefer rows that look like labels, not data / error rows.
    const score = textCells * 3 - numericCells;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  return bestIndex;
}

export async function parseWorkbookFile(file: File): Promise<ParsedWorkbook> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });

  return {
    fileName: file.name,
    sheetNames: workbook.SheetNames,
    workbook,
  };
}

const BARE_GAME_METRIC_KEYS = new Set([
  "bet count",
  "total stake",
  "total turnover",
  "total profit loss",
  "total profit and loss",
]);

function isBareGameMetricLabel(header: string): boolean {
  return BARE_GAME_METRIC_KEYS.has(normalizeHeader(header));
}

/**
 * Resolve header labels for Aff/Player Raw sheets.
 * Supports two-row Excel layouts where a game category row
 * (Card / Slots / Crash / …) sits above repeating
 * Bet Count | Total Stake | Total Turnover | Total Profit&Loss.
 */
export function resolveSheetHeaderLabels(
  matrix: (string | number | boolean | Date | null)[][],
): { headers: string[]; headerRowIndex: number } {
  if (matrix.length === 0) return { headers: [], headerRowIndex: 0 };

  const headerRowIndex = findHeaderRowIndex(matrix);
  const metricRow = matrix[headerRowIndex] ?? [];
  const categoryRow =
    headerRowIndex > 0 ? (matrix[headerRowIndex - 1] ?? []) : [];

  const width = Math.max(metricRow.length, categoryRow.length);
  const filledCategories: string[] = [];
  let currentCategory = "";
  let seenCategory = false;
  for (let i = 0; i < width; i += 1) {
    const cat = cellToString(categoryRow[i] ?? "").trim();
    if (cat) {
      currentCategory = cat;
      seenCategory = true;
    }
    // Only forward-fill after the first real category label so core columns
    // (Month … Total Net Profit) are not prefixed by a sheet title.
    filledCategories[i] = seenCategory ? currentCategory : "";
  }

  const headers: string[] = [];
  for (let i = 0; i < width; i += 1) {
    const metric = cellToString(metricRow[i] ?? "").trim();
    if (!metric) {
      headers.push("");
      continue;
    }
    if (isDynamicGameMetricHeader(metric)) {
      headers.push(metric);
      continue;
    }
    const category = (filledCategories[i] ?? "").trim();
    if (category && isBareGameMetricLabel(metric)) {
      const combined = `${category} ${metric}`.replace(/\s+/g, " ").trim();
      if (isDynamicGameMetricHeader(combined)) {
        headers.push(combined);
        continue;
      }
    }
    headers.push(metric);
  }

  return { headers, headerRowIndex };
}

export function getSheetHeaders(
  workbook: XLSX.WorkBook,
  sheetName: string,
): string[] {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];

  const rows = XLSX.utils.sheet_to_json<(string | number | boolean | Date | null)[]>(
    sheet,
    { header: 1, defval: "", raw: false },
  );

  const { headers } = resolveSheetHeaderLabels(rows);
  // Keep blanks out of the "detected header" list, but buildRawUploadColumns
  // only needs the non-empty labels for game discovery.
  return headers.map((header) => header.trim()).filter(Boolean);
}

export function mapSheetToColumns(
  workbook: XLSX.WorkBook,
  sheetName: string,
  targetColumns: string[],
): {
  rows: string[][];
  matchedColumns: string[];
  missingColumns: string[];
  headerRowIndex: number;
} {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    return {
      rows: [],
      matchedColumns: [],
      missingColumns: [...targetColumns],
      headerRowIndex: 0,
    };
  }

  const matrix = XLSX.utils.sheet_to_json<(string | number | boolean | Date | null)[]>(
    sheet,
    { header: 1, defval: "", raw: false },
  );

  if (matrix.length === 0) {
    return {
      rows: [],
      matchedColumns: [],
      missingColumns: [...targetColumns],
      headerRowIndex: 0,
    };
  }

  const { headers: sourceHeaders, headerRowIndex } = resolveSheetHeaderLabels(matrix);
  const sourceIndexByNormalized = new Map<string, number>();

  sourceHeaders.forEach((header, index) => {
    const key = normalizeHeader(header);
    if (key && !sourceIndexByNormalized.has(key)) {
      sourceIndexByNormalized.set(key, index);
    }
  });

  const columnSourceIndexes = targetColumns.map((column) =>
    resolveSourceIndex(column, sourceIndexByNormalized, sourceHeaders),
  );

  const matchedColumns = targetColumns.filter((_, index) => columnSourceIndexes[index] !== -1);
  const missingColumns = targetColumns.filter((_, index) => columnSourceIndexes[index] === -1);

  const rows = matrix.slice(headerRowIndex + 1).map((row) =>
    columnSourceIndexes.map((sourceIndex) =>
      sourceIndex >= 0 ? cellToString(row[sourceIndex] ?? "") : "",
    ),
  );

  const nonEmptyRows = rows.filter((row) => !isSpacerRow(row));

  return {
    rows: nonEmptyRows,
    matchedColumns,
    missingColumns,
    headerRowIndex,
  };
}

/**
 * Map sheet rows by column position (skip header row). Used when Week Detail
 * header labels don't match aliases but the export column order is the same.
 */
export function mapSheetPositional(
  workbook: XLSX.WorkBook,
  sheetName: string,
  columnCount: number,
): { rows: string[][]; headerRowIndex: number } {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet || columnCount <= 0) {
    return { rows: [], headerRowIndex: 0 };
  }

  const matrix = XLSX.utils.sheet_to_json<(string | number | boolean | Date | null)[]>(
    sheet,
    { header: 1, defval: "", raw: false },
  );
  if (matrix.length === 0) return { rows: [], headerRowIndex: 0 };

  const headerRowIndex = findHeaderRowIndex(matrix);
  const rows = matrix
    .slice(headerRowIndex + 1)
    .map((row) => {
      const out: string[] = [];
      for (let i = 0; i < columnCount; i += 1) {
        out.push(cellToString(row[i] ?? ""));
      }
      return out;
    })
    .filter((row) => !isSpacerRow(row));

  return { rows, headerRowIndex };
}
