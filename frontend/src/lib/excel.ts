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

function cellToString(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value);
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

  const headerRow = rows[0] ?? [];
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
} {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    return { rows: [], matchedColumns: [], missingColumns: [...targetColumns] };
  }

  const matrix = XLSX.utils.sheet_to_json<(string | number | boolean | Date | null)[]>(
    sheet,
    { header: 1, defval: "", raw: false },
  );

  if (matrix.length === 0) {
    return { rows: [], matchedColumns: [], missingColumns: [...targetColumns] };
  }

  const headerRow = matrix[0] ?? [];
  const sourceHeaders = headerRow.map((cell) => cellToString(cell));
  const sourceIndexByNormalized = new Map<string, number>();

  sourceHeaders.forEach((header, index) => {
    const key = normalizeHeader(header);
    if (key && !sourceIndexByNormalized.has(key)) {
      sourceIndexByNormalized.set(key, index);
    }
  });

  const columnSourceIndexes = targetColumns.map((column) => {
    const key = normalizeHeader(column);
    return sourceIndexByNormalized.get(key) ?? -1;
  });

  const matchedColumns = targetColumns.filter((_, index) => columnSourceIndexes[index] !== -1);
  const missingColumns = targetColumns.filter((_, index) => columnSourceIndexes[index] === -1);

  const rows = matrix.slice(1).map((row) =>
    columnSourceIndexes.map((sourceIndex) =>
      sourceIndex >= 0 ? cellToString(row[sourceIndex] ?? "") : "",
    ),
  );

  // Drop completely empty rows
  const nonEmptyRows = rows.filter((row) => row.some((cell) => cell.trim() !== ""));

  return {
    rows: nonEmptyRows,
    matchedColumns,
    missingColumns,
  };
}
