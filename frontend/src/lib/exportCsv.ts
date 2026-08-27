import { MONEY_DISPLAY_COLUMNS } from "../config/reports";
import { formatMoneyDisplay } from "./weeklyCompute";

/** Escape a CSV cell (RFC-style quotes when needed). */
export function escapeCsvCell(value: unknown): string {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function formatCsvNumber(column: string, n: number): string {
  if (MONEY_DISPLAY_COLUMNS.has(column) || column === "FINAL NET") {
    return formatMoneyDisplay(n);
  }
  return Math.round(n).toLocaleString("en-US");
}

export function rowsToCsv(columns: string[], rows: string[][]): string {
  const header = columns.map(escapeCsvCell).join(",");
  const body = rows.map((row) =>
    columns
      .map((_, index) => {
        const raw = row[index] ?? "";
        const text = String(raw).trim();
        const column = columns[index] ?? "";
        if (
          !text ||
          text.endsWith("%") ||
          /^\d{4}W\d{2}$/i.test(text) ||
          column === "SU MONTH" ||
          column === "Affiliate Username" ||
          column === "Status" ||
          column === "Comm %"
        ) {
          return escapeCsvCell(raw);
        }
        const cleaned = text.replace(/,/g, "");
        if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(cleaned)) {
          const paren = /^\(\s*([\d.]+)\s*\)$/.exec(cleaned);
          if (paren) {
            const n = -Math.abs(Number(paren[1]));
            if (!Number.isFinite(n)) return escapeCsvCell(raw);
            return escapeCsvCell(formatCsvNumber(column, n));
          }
          return escapeCsvCell(raw);
        }
        const n = Number(cleaned);
        if (!Number.isFinite(n)) return escapeCsvCell(raw);
        return escapeCsvCell(formatCsvNumber(column, n));
      })
      .join(","),
  );
  return [header, ...body].join("\r\n");
}

/** Safe filename fragment: letters, numbers, dash, underscore. */
export function slugFilenamePart(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]+/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "export";
}

/** Trigger a browser download for any Blob. */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/**
 * Download CSV with UTF-8 BOM so Excel opens accents/unicode cleanly.
 */
export function downloadCsv(filename: string, csvContent: string): void {
  const name = filename.toLowerCase().endsWith(".csv") ? filename : `${filename}.csv`;
  const blob = new Blob([`\uFEFF${csvContent}`], {
    type: "text/csv;charset=utf-8;",
  });
  downloadBlob(name, blob);
}

export function exportTableCsv(params: {
  columns: string[];
  rows: string[][];
  filenameParts: string[];
}): void {
  const { columns, rows, filenameParts } = params;
  if (columns.length === 0) return;

  const csv = rowsToCsv(columns, rows);
  const filename = `${filenameParts.map(slugFilenamePart).join("_")}.csv`;
  downloadCsv(filename, csv);
}
