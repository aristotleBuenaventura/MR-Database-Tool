import { isValidWeekCode, normalizeWeekCode } from "./weeklyImport";

const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export type WeekDateRange = {
  start: Date;
  end: Date;
  source: "file";
};

function utcDate(year: number, monthIndex: number, day: number): Date {
  return new Date(Date.UTC(year, monthIndex, day));
}

function columnIndex(columns: string[], ...names: string[]): number {
  const keys = names.map((name) => name.trim().toLowerCase());
  return columns.findIndex((column) => keys.includes(column.trim().toLowerCase()));
}

function expandYear(year: number): number {
  if (year >= 100) return year;
  return year >= 70 ? 1900 + year : 2000 + year;
}

function calendarDate(year: number, monthIndex: number, day: number): Date | null {
  if (monthIndex < 0 || monthIndex > 11 || day < 1 || day > 31) return null;
  const date = utcDate(year, monthIndex, day);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== monthIndex ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

export function parseDateCell(value: string): Date | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const ymd = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/.exec(raw);
  if (ymd) {
    return calendarDate(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));
  }

  // Raw exports use Excel dates such as 08/31/26 and 09/06/26 (month/day).
  // Keep that calendar day. Parsing through UTC shifts it one day earlier in PH.
  const numeric = /^(\d{1,2})([./-])(\d{1,2})\2(\d{2,4})$/.exec(raw);
  if (numeric) {
    const first = Number(numeric[1]);
    const separator = numeric[2];
    const second = Number(numeric[3]);
    const year = expandYear(Number(numeric[4]));
    let month = first;
    let day = second;
    if (first > 12 && second <= 12) {
      day = first;
      month = second;
    } else if (second > 12 && first <= 12) {
      month = first;
      day = second;
    } else if (separator !== "/") {
      day = first;
      month = second;
    }
    return calendarDate(year, month - 1, day);
  }

  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) return null;
  const date = new Date(parsed);
  return calendarDate(date.getFullYear(), date.getMonth(), date.getDate());
}

export function formatWeekDateRange(start: Date, end: Date): string {
  const format = (date: Date) =>
    `${date.getUTCDate()} ${MONTH_SHORT[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
  return `${format(start)} – ${format(end)}`;
}

export function extractWeekDateRangeFromPlayerRaw(
  columns: string[],
  rows: string[][],
  weekCode: string,
): WeekDateRange | null {
  const week = normalizeWeekCode(weekCode);
  const startIdx = columnIndex(columns, "Start", "Start Date");
  const endIdx = columnIndex(columns, "End", "End Date");
  if (startIdx < 0 || endIdx < 0) return null;

  const weekIdx = columnIndex(columns, "Month", "Week", "Date");
  for (const row of rows) {
    if (weekIdx >= 0) {
      const rowWeek = normalizeWeekCode(String(row[weekIdx] ?? ""));
      if (isValidWeekCode(rowWeek) && rowWeek !== week) continue;
    }
    const start = parseDateCell(String(row[startIdx] ?? ""));
    const end = parseDateCell(String(row[endIdx] ?? ""));
    if (start && end) return { start, end, source: "file" };
  }
  return null;
}

export function resolveWeekDateRange(
  weekCode: string,
  playerRaw?: { columns: string[]; rows: string[][] } | null,
): WeekDateRange | null {
  if (!playerRaw) return null;
  return extractWeekDateRangeFromPlayerRaw(playerRaw.columns, playerRaw.rows, weekCode);
}

export function resolveWeekDateRangeLabel(
  weekCode: string,
  playerRaw?: { columns: string[]; rows: string[][] } | null,
): string | null {
  const range = resolveWeekDateRange(weekCode, playerRaw);
  if (!range) return null;
  return formatWeekDateRange(range.start, range.end);
}
