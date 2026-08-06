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

const HEADER_ALIASES: Record<string, string[]> = {
  "system commission": ["system commissioon", "system commission"],
  "final net": ["final net include ve carry over", "final net"],
  "last week ncf": ["last week negative carry over", "last week ncf"],
  "next week ncf": ["next week negative carry over", "next week ncf"],
  "last week negative carry over": ["last week negative carry over", "last week ncf"],
  "next week negative carry over": ["next week negative carry over", "next week ncf"],
  "number of first deposit": ["number of first deposits", "number of first deposit"],
  "ap to 0": ["ap to 0", "ap (to>0)", "ap(to>0)"],
  "ap qualified to 1000": [
    "ap qualified to 1000",
    "ap qualified (to>1000)",
    "ap qualified (to > 1000)",
  ],
  "aff raw bonus": ["aff raw bonus"],
  "player raw bonus": ["player raw bonus"],
  "su month": ["su month"],
  "total profit loss": ["total profit loss", "total profit loss"],
  "total vip cash bonus": ["total vip cash bonus", "vip cash bonus"],
  "final comm": ["final comm", "final commission"],
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

function cellToString(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
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

  const headerIndex = findHeaderRowIndex(rows);
  const headerRow = rows[headerIndex] ?? [];
  return headerRow.map((cell) => cellToString(cell).trim()).filter(Boolean);
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

  const headerRowIndex = findHeaderRowIndex(matrix);
  const headerRow = matrix[headerRowIndex] ?? [];
  const sourceHeaders = headerRow.map((cell) => cellToString(cell));
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
