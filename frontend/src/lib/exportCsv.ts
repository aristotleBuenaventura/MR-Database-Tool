/** Escape a CSV cell (RFC-style quotes when needed). */
export function escapeCsvCell(value: unknown): string {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function rowsToCsv(columns: string[], rows: string[][]): string {
  const header = columns.map(escapeCsvCell).join(",");
  const body = rows.map((row) =>
    columns.map((_, index) => escapeCsvCell(row[index] ?? "")).join(","),
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

/**
 * Download CSV with UTF-8 BOM so Excel opens accents/unicode cleanly.
 */
export function downloadCsv(filename: string, csvContent: string): void {
  const name = filename.toLowerCase().endsWith(".csv") ? filename : `${filename}.csv`;
  const blob = new Blob([`\uFEFF${csvContent}`], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
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
