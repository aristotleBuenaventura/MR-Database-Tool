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
  source: "file" | "iso";
};

function utcDate(year: number, monthIndex: number, day: number): Date {
  return new Date(Date.UTC(year, monthIndex, day));
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatUtcIsoDate(date: Date): string {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

function columnIndex(columns: string[], ...names: string[]): number {
  const keys = names.map((name) => name.trim().toLowerCase());
  return columns.findIndex((column) => keys.includes(column.trim().toLowerCase()));
}

/** Monday–Sunday range for an ISO week code like 2026W35. */
export function isoWeekDateRange(weekCode: string): WeekDateRange | null {
  const week = normalizeWeekCode(weekCode);
  if (!isValidWeekCode(week)) return null;

  const year = Number(week.slice(0, 4));
  const weekNo = Number(week.slice(5));
  if (weekNo < 1 || weekNo > 53) return null;

  // ISO week 1 contains January 4. Monday of that week is the origin.
  const jan4 = utcDate(year, 0, 4);
  const jan4Day = jan4.getUTCDay() || 7;
  const mondayWeek1 = utcDate(year, 0, 4 - (jan4Day - 1));
  const start = utcDate(
    mondayWeek1.getUTCFullYear(),
    mondayWeek1.getUTCMonth(),
    mondayWeek1.getUTCDate() + (weekNo - 1) * 7,
  );
  const end = utcDate(
    start.getUTCFullYear(),
    start.getUTCMonth(),
    start.getUTCDate() + 6,
  );
  return { start, end, source: "iso" };
}

export function parseDateCell(value: string): Date | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (ymd) {
    return utcDate(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));
  }

  const dmy = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(raw);
  if (dmy) {
    const first = Number(dmy[1]);
    const second = Number(dmy[2]);
    const year = Number(dmy[3]);
    if (first > 12) return utcDate(year, second - 1, first);
    if (second > 12) return utcDate(year, first - 1, second);
    return utcDate(year, second - 1, first);
  }

  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) return null;
  const date = new Date(parsed);
  return utcDate(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
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
  const fromFile = playerRaw
    ? extractWeekDateRangeFromPlayerRaw(playerRaw.columns, playerRaw.rows, weekCode)
    : null;
  return fromFile ?? isoWeekDateRange(weekCode);
}

export function resolveWeekDateRangeLabel(
  weekCode: string,
  playerRaw?: { columns: string[]; rows: string[][] } | null,
): string | null {
  const range = resolveWeekDateRange(weekCode, playerRaw);
  if (!range) return null;
  return formatWeekDateRange(range.start, range.end);
}

export function weekDateRangeInputs(
  weekCode: string,
  playerRaw?: { columns: string[]; rows: string[][] } | null,
): { from: string; to: string } | null {
  const range = resolveWeekDateRange(weekCode, playerRaw);
  if (!range) return null;
  return {
    from: formatUtcIsoDate(range.start),
    to: formatUtcIsoDate(range.end),
  };
}

/** Keep weeks whose Mon–Sun range overlaps the From/To filter. Empty dates = all weeks. */
export function weeksMatchingDateFilter(
  weeks: string[],
  fromValue: string,
  toValue: string,
): string[] {
  const from = parseDateCell(fromValue);
  const to = parseDateCell(toValue);
  if (!from && !to) return weeks;

  const startBound = from ?? to!;
  const endBound = to ?? from!;
  const lo = startBound.getTime() <= endBound.getTime() ? startBound : endBound;
  const hi = startBound.getTime() <= endBound.getTime() ? endBound : startBound;

  return weeks.filter((week) => {
    const range = isoWeekDateRange(week);
    if (!range) return false;
    return range.start.getTime() <= hi.getTime() && range.end.getTime() >= lo.getTime();
  });
}
