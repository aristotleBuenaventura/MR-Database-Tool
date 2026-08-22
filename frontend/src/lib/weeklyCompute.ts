import {
  TAB_COLUMNS,
  WEEKLY_DETAIL_COLUMNS,
  WEEKLY_KPI_COLUMNS,
  type ReportTabId,
} from "../config/reports";

function norm(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\n\r]+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function colMap(columns: readonly string[]): Map<string, number> {
  const map = new Map<string, number>();
  columns.forEach((column, index) => {
    const key = norm(column);
    if (key && !map.has(key)) map.set(key, index);
  });
  return map;
}

function idx(map: Map<string, number>, ...aliases: string[]): number {
  for (const alias of aliases) {
    const found = map.get(norm(alias));
    if (found != null) return found;
  }
  return -1;
}

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  let raw = String(value ?? "")
    .replace(/,/g, "")
    .replace(/%/g, "")
    .trim();
  if (!raw) return 0;

  // Excel-style accounting negative: (1234)
  const paren = /^\(\s*([\d.]+)\s*\)$/.exec(raw);
  if (paren) {
    const n = Number(paren[1]);
    return Number.isFinite(n) ? -Math.abs(n) : 0;
  }

  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Excel ROUND — half away from zero.
 * JS Math.round(-2.5) === -2; Excel ROUND(-2.5,0) === -3.
 * That mismatch causes occasional ±1 Difference vs the source sheet.
 */
export function roundExcel(n: number, digits = 0): number {
  if (!Number.isFinite(n)) return 0;
  const factor = 10 ** digits;
  const scaled = n * factor;
  const rounded = Math.sign(scaled) * Math.floor(Math.abs(scaled) + 0.5);
  return rounded / factor;
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return String(roundExcel(n));
}

/** Keep up to 2 decimal places for intermediate money fields used in formulas. */
function fmtDecimal(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return String(roundExcel(n, 2));
}

function cell(row: string[] | undefined, index: number): string {
  if (index < 0) return "";
  return String(row?.[index] ?? "").trim();
}

function key2(a: string, b: string): string {
  return `${a.toLowerCase()}::${b.toLowerCase()}`;
}

function indexRows(rows: string[][], monthCol: number, userCol: number): Map<string, string[][]> {
  const map = new Map<string, string[][]>();
  for (const row of rows) {
    const month = cell(row, monthCol);
    const user = cell(row, userCol);
    if (!month || !user) continue;
    const k = key2(month, user);
    const list = map.get(k);
    if (list) list.push(row);
    else map.set(k, [row]);
  }
  return map;
}

function sumCol(rows: string[][] | undefined, col: number): number {
  if (!rows || col < 0) return 0;
  let total = 0;
  for (const row of rows) total += toNumber(row[col]);
  return total;
}

function countCol(
  rows: string[][] | undefined,
  col: number,
  predicate: (n: number) => boolean,
): number {
  if (!rows || col < 0) return 0;
  let count = 0;
  for (const row of rows) {
    if (predicate(toNumber(row[col]))) count += 1;
  }
  return count;
}

/** Full-precision helpers stay in compute*; formatters are for output only. */

/**
 * Money formatter that PRESERVES up to 2 decimals.
 *
 * Used for commission values (Final Commission, Commission) so per-row amounts
 * are not rounded to whole numbers before being summed. Rounding each row first
 * accumulates a small error vs Excel, which keeps the cents (e.g. 4169.25).
 * The grid still displays these as whole numbers, but sums stay accurate.
 */
function fmtMoney(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return String(roundExcel(n, 2));
}

type Bundle = Partial<Record<ReportTabId, string[][]>>;

/**
 * FINAL NET from TK BDT Online Website Source (column V):
 * =IF(W+U<0, W+U, IF(W+U>0, W+U, 0))
 * where U = Net Profit, W = Last Week Negative Carry Over.
 */
export function computeFinalNet(lastWeekNcf: number, netProfit: number): number {
  const sum = lastWeekNcf + netProfit;
  if (sum < 0) return sum;
  if (sum > 0) return sum;
  return 0;
}

/** Guideline Deduction: if Gross (N) > 0 then N * 18%, else 0 */
export function computeDeduction(grossRevenue: number): number {
  return grossRevenue > 0 ? grossRevenue * 0.18 : 0;
}

/**
 * Guideline Net Profit:
 * - if TPL > 0: TPL - Deduction - AffRawBonus - VIP
 * - if TPL < 0: TPL - AffRawBonus - VIP
 */
export function computeNetProfit(
  totalProfitLoss: number,
  deduction: number,
  affRawBonus: number,
  vipCashBonus: number,
): number {
  if (totalProfitLoss < 0) return totalProfitLoss - affRawBonus - vipCashBonus;
  return totalProfitLoss - deduction - affRawBonus - vipCashBonus;
}

/**
 * Comm % rate for formulas.
 * Accepts "50%", "0.5", or "50" → always a 0–1 multiplier (default 50% = 0.5).
 */
export function parseCommRate(value: unknown): number {
  const raw = String(value ?? "")
    .trim()
    .replace(/,/g, "");
  if (!raw) return 0.5;

  const hasPercent = raw.includes("%");
  const n = Number(raw.replace(/%/g, "").trim());
  if (!Number.isFinite(n)) return 0.5;

  // "50%" or plain 50 → 0.5; already-fraction 0.5 stays 0.5
  if (hasPercent || Math.abs(n) > 1) return n / 100;
  return n;
}

/**
 * Comm % rate (0–1):
 * 50% only when FINAL NET >= 1 AND AP(TO>0) > 0; otherwise 0%.
 * (Covers: FINAL NET <= 0 → 0%; FINAL NET >= 1 but AP < 1 → 0%.)
 */
export function computeCommPct(ap: number, finalNet: number): number {
  if (finalNet >= 1 && ap > 0) return 0.5;
  return 0;
}

export function formatCommPct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

/** Calculated Commission = ROUND(Comm % × precise FINAL NET) — Excel-style. */
export function computeCalculatedCommission(commPct: unknown, finalNet: number): number {
  return roundExcel(finalNet * parseCommRate(commPct));
}

/** Tooltip label for FINAL NET: unrounded value with 2 decimals + thousands commas. */
export function formatFinalNetPrecise(preciseFinalNet: number): string {
  if (!Number.isFinite(preciseFinalNet)) return "0.00";
  return roundExcel(preciseFinalNet, 2).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Rebuild precise FINAL NET from row inputs.
 * Prefers recomputing Net Profit from Gross / Deduction / bonuses so older
 * whole-rounded Net Profit cells still yield the correct 2-decimal value.
 */
export function preciseFinalNetFromWeekDetailRow(
  row: string[],
  columns: readonly string[] = WEEKLY_DETAIL_COLUMNS,
): number {
  const cols = colMap(columns);
  const iLastNcf = idx(cols, "Last Week Negative Carry Over", "Last Week NCF");
  const iGross = idx(cols, "Gross Revenue");
  const iTpl = idx(cols, "Total Profit & Loss");
  const iAffBonus = idx(cols, "Aff Raw Bonus");
  const iVip = idx(cols, "VIP Cash Bonus");
  const iNetProfit = idx(cols, "Net Profit");

  const lastWeekNcf = toNumber(row[iLastNcf]);
  const grossRevenue = toNumber(row[iGross]);
  const totalProfitLoss = toNumber(row[iTpl]) || grossRevenue;
  const affRawBonus = toNumber(row[iAffBonus]);
  const vipCashBonus = toNumber(row[iVip]);

  const netProfit =
    iGross >= 0 || iTpl >= 0
      ? computeNetProfit(
          totalProfitLoss,
          computeDeduction(grossRevenue || totalProfitLoss),
          affRawBonus,
          vipCashBonus,
        )
      : toNumber(row[iNetProfit]);

  return computeFinalNet(lastWeekNcf, netProfit);
}

/** Recalculate dependent week-detail fields after editable cell changes. */
export function recalculateWeeklyDetailRow(row: string[]): string[] {
  const cols = colMap(WEEKLY_DETAIL_COLUMNS);
  const next = [...row];
  while (next.length < WEEKLY_DETAIL_COLUMNS.length) next.push("");

  const iAdj = idx(cols, "Adjustment");
  const iFinal = idx(cols, "Final Commission");
  const iDiff = idx(cols, "Difference");
  const iSystem = idx(cols, "System Commission");
  const iCalc = idx(cols, "Calculated Commission");
  const iComm = idx(cols, "Comm %");
  const iAp = idx(cols, "AP(TO>0)");
  const iGross = idx(cols, "Gross Revenue");
  const iDed = idx(cols, "Deduction");
  const iAffBonus = idx(cols, "Aff Raw Bonus");
  const iVip = idx(cols, "VIP Cash Bonus");
  const iTpl = idx(cols, "Total Profit & Loss");
  const iNetProfit = idx(cols, "Net Profit");
  const iFinalNet = idx(cols, "FINAL NET");
  const iLastNcf = idx(cols, "Last Week Negative Carry Over", "Last Week NCF");
  const iNextNcf = idx(cols, "Next Week Negative Carry Over", "Next Week NCF");

  const adjustment = toNumber(next[iAdj]);
  const systemCommission = toNumber(next[iSystem]);
  const ap = toNumber(next[iAp]);
  const grossRevenue = toNumber(next[iGross]);
  const affRawBonus = toNumber(next[iAffBonus]);
  const vipCashBonus = toNumber(next[iVip]);
  const totalProfitLoss = toNumber(next[iTpl]) || grossRevenue;
  // Keep edited carry-over decimals — do not whole-round before FINAL NET / commission.
  const lastWeekNcf = toNumber(next[iLastNcf]);

  const deduction = computeDeduction(grossRevenue);
  // Keep Net Profit decimals; only FINAL NET display is whole-rounded.
  const netProfit = computeNetProfit(
    totalProfitLoss,
    deduction,
    affRawBonus,
    vipCashBonus,
  );
  const finalNetPrecise = computeFinalNet(lastWeekNcf, netProfit);
  const finalNetRounded = roundExcel(finalNetPrecise);
  // Comm % / Calculated Commission use precise FINAL NET (not the rounded display).
  next[iComm] = formatCommPct(computeCommPct(ap, finalNetPrecise));
  const calculatedCommission = computeCalculatedCommission(
    next[iComm],
    finalNetPrecise,
  );
  const finalCommission = systemCommission + adjustment;
  // Difference uses whole-number Calculated vs rounded System.
  const difference = calculatedCommission - roundExcel(systemCommission);
  const nextWeekNcf = finalNetPrecise < 0 ? finalNetRounded : 0;

  next[iDed] = fmtDecimal(deduction);
  next[iTpl] = fmtDecimal(totalProfitLoss);
  next[iNetProfit] = fmtDecimal(netProfit);
  next[iFinalNet] = fmt(finalNetRounded);
  next[iCalc] = fmt(calculatedCommission);
  next[iFinal] = fmtMoney(finalCommission);
  next[iDiff] = fmt(difference);
  next[iLastNcf] = fmtDecimal(lastWeekNcf);
  next[iNextNcf] = fmt(nextWeekNcf);

  return next;
}

/**
 * Build week detail rows from sources using MR Database Source List formulas.
 */
export function computeWeeklyDetail(params: {
  week: string;
  sources: Bundle;
  prevWeekDetail?: string[][];
}): string[][] {
  const week = params.week;
  const affSu = params.sources["aff-su"] ?? [];
  const affRaw = params.sources["aff-raw-upload"] ?? [];
  const playerRaw = params.sources["player-raw-upload"] ?? [];
  const systemComm = params.sources["system-comm-raw"] ?? [];
  const paidComm = params.sources["paid-comm"] ?? [];
  const prevWeek = params.prevWeekDetail ?? [];

  const affSuCols = colMap(TAB_COLUMNS["aff-su"]);
  const affRawCols = colMap(TAB_COLUMNS["aff-raw-upload"]);
  const playerCols = colMap(TAB_COLUMNS["player-raw-upload"]);
  const systemCols = colMap(TAB_COLUMNS["system-comm-raw"]);
  const paidCols = colMap(TAB_COLUMNS["paid-comm"]);
  const weekCols = colMap(WEEKLY_DETAIL_COLUMNS);

  const suUser = idx(affSuCols, "Affiliate Username");

  const arMonth = idx(affRawCols, "Month");
  const arUser = idx(affRawCols, "Affiliate Username");
  const arAp = idx(affRawCols, "Active Players");
  const arGross = idx(affRawCols, "Total Profit&Loss", "Total Profit & Loss");
  const arBonus = idx(affRawCols, "Total Bonus");
  const arVip = idx(affRawCols, "VIP Cash Bonus");
  const arNet = idx(affRawCols, "Total Net Profit");

  const prMonth = idx(playerCols, "Month");
  const prUser = idx(playerCols, "Affiliate Username");
  const prTurnover = idx(playerCols, "Total Turnover");
  const prBonus = idx(playerCols, "Total Bonus");

  const scMonth = idx(systemCols, "Month");
  const scUser = idx(systemCols, "Affiliate Username");
  const scAmount = idx(systemCols, "Original Amount");

  const pcMonth = idx(paidCols, "Month");
  const pcUser = idx(paidCols, "Affiliate Username");
  const pcStatus = idx(paidCols, "Status");
  const pcAdj = idx(paidCols, "Adjustment");

  const wUser = idx(weekCols, "Affiliate Username");
  const wFinal = idx(weekCols, "Final Commission");
  const wNextNcf = idx(weekCols, "Next Week Negative Carry Over", "Next Week NCF");

  const affRawIdx = indexRows(affRaw, arMonth, arUser);
  const playerIdx = indexRows(playerRaw, prMonth, prUser);
  const systemIdx = indexRows(systemComm, scMonth, scUser);
  const paidIdx = indexRows(paidComm, pcMonth, pcUser);

  const prevByUser = new Map<string, string[]>();
  for (const row of prevWeek) {
    const username = cell(row, wUser);
    if (username) prevByUser.set(username.toLowerCase(), row);
  }

  const usernames: string[] = [];
  const seen = new Set<string>();

  const pushUser = (username: string) => {
    const trimmed = username.trim();
    if (!trimmed) return;
    const lower = trimmed.toLowerCase();
    if (seen.has(lower)) return;
    seen.add(lower);
    usernames.push(trimmed);
  };

  // Primary: affiliates with Aff Raw activity this week.
  for (const row of affRaw) {
    if (cell(row, arMonth).toUpperCase() !== week.toUpperCase()) continue;
    pushUser(cell(row, arUser));
  }

  // Also include System Comm / Paid Comm usernames for the week.
  for (const row of systemComm) {
    if (cell(row, scMonth).toUpperCase() !== week.toUpperCase()) continue;
    pushUser(cell(row, scUser));
  }
  for (const row of paidComm) {
    if (cell(row, pcMonth).toUpperCase() !== week.toUpperCase()) continue;
    pushUser(cell(row, pcUser));
  }

  // Carry-over continuity: previous-week affiliates with non-zero Next Week NCF
  // even if they have no Aff Raw activity this week.
  for (const [lower, prevRow] of prevByUser) {
    if (seen.has(lower)) continue;
    const ncf = toNumber(cell(prevRow, wNextNcf));
    if (ncf === 0) continue;
    const username = cell(prevRow, wUser);
    pushUser(username);
  }

  // If nothing else matched, fall back to Aff SU list (legacy / empty-week bootstrap).
  if (usernames.length === 0) {
    for (const row of affSu) {
      pushUser(cell(row, suUser));
    }
  }

  const out: string[][] = [];

  for (const username of usernames) {
    const lower = username.toLowerCase();
    const affRows = affRawIdx.get(key2(week, username));
    const playerRows = playerIdx.get(key2(week, username));
    const systemRows = systemIdx.get(key2(week, username));
    const paidRows = paidIdx.get(key2(week, username));
    const prev = prevByUser.get(lower);

    const status = normalizePaymentStatus(cell(paidRows?.[0], pcStatus));
    const adjustment = toNumber(cell(paidRows?.[0], pcAdj));
    const systemCommission = sumCol(systemRows, scAmount);
    const ap = sumCol(affRows, arAp);
    // Guideline: Column T (turnover) more than 1000
    const apQualified = countCol(playerRows, prTurnover, (n) => n > 1000);
    const grossRevenue = sumCol(affRows, arGross);
    const deduction = computeDeduction(grossRevenue);
    const affRawBonus = sumCol(affRows, arBonus);
    const playerRawBonus = sumCol(playerRows, prBonus);
    const vipCashBonus = sumCol(affRows, arVip);
    const netRevenue = sumCol(affRows, arNet);
    const totalProfitLoss = grossRevenue;
    // Keep decimals through Net Profit / precise FINAL NET; round only the
    // displayed FINAL NET cell. Calculated Commission uses the precise value.
    const netProfit = computeNetProfit(
      totalProfitLoss,
      deduction,
      affRawBonus,
      vipCashBonus,
    );
    const lastWeekNcf = toNumber(cell(prev, wNextNcf));
    const finalNetPrecise = computeFinalNet(lastWeekNcf, netProfit);
    const finalNetRounded = roundExcel(finalNetPrecise);
    const commPctLabel = formatCommPct(computeCommPct(ap, finalNetPrecise));
    const calculatedCommission = computeCalculatedCommission(
      commPctLabel,
      finalNetPrecise,
    );
    const finalCommission = systemCommission + adjustment;
    const difference = calculatedCommission - roundExcel(systemCommission);
    const lastWeekCommission = toNumber(cell(prev, wFinal));
    const nextWeekNcf = finalNetPrecise < 0 ? finalNetRounded : 0;
    // Auto-mark as Paid when Final Commission is a positive number.
    const finalStatus = finalCommission > 0 ? "Paid" : status;

    out.push([
      week,
      username,
      finalStatus,
      adjustment ? String(adjustment) : "",
      fmtMoney(finalCommission),
      fmt(difference),
      fmtMoney(systemCommission),
      fmt(calculatedCommission),
      commPctLabel,
      fmtDecimal(lastWeekCommission),
      String(ap),
      String(apQualified),
      fmtDecimal(grossRevenue),
      fmtDecimal(deduction),
      fmtDecimal(affRawBonus),
      fmtDecimal(playerRawBonus),
      fmtDecimal(vipCashBonus),
      fmtDecimal(netRevenue),
      fmtDecimal(totalProfitLoss),
      fmtDecimal(netProfit),
      fmt(finalNetRounded),
      fmtDecimal(lastWeekNcf),
      fmt(nextWeekNcf),
    ]);
  }

  return out;
}

/** Paid Comm = only affiliates marked Paid on the Week Detail tab. */
export function normalizePaymentStatus(value: unknown): "Paid" | "Unpaid" {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();
  if (raw === "paid") return "Paid";
  return "Unpaid";
}

export function isPaidStatus(value: unknown): boolean {
  return normalizePaymentStatus(value) === "Paid";
}

/** Marker stored on ReportDataset.location for base Week Detail uploads. */
export const BASE_WEEK_DETAIL_LOCATION = "base-upload";

/** Separate DB category so raw-import computes cannot overwrite a base upload. */
export const BASE_WEEK_DETAIL_CATEGORY = "base";

export function isBaseWeekDetailLocation(
  location: string | null | undefined,
): boolean {
  return String(location ?? "").trim() === BASE_WEEK_DETAIL_LOCATION;
}

export function isBaseWeekDetailCategory(
  category: string | null | undefined,
): boolean {
  return String(category ?? "").trim() === BASE_WEEK_DETAIL_CATEGORY;
}

/**
 * Pad / trim Week Detail rows and normalize Status only — no formula recalc.
 * Used for base uploads so Excel values stay as-is.
 */
export function sanitizeWeekDetailRows(rows: string[][]): string[][] {
  const iStatus = idx(colMap(WEEKLY_DETAIL_COLUMNS), "Status");
  return rows.map((row) => {
    const base =
      row.length > WEEKLY_DETAIL_COLUMNS.length ? row.slice(1) : row;
    const next = [...base];
    while (next.length < WEEKLY_DETAIL_COLUMNS.length) next.push("");
    if (iStatus >= 0) next[iStatus] = normalizePaymentStatus(next[iStatus]);
    return next;
  });
}

export function normalizeWeekDetailStatuses(rows: string[][]): string[][] {
  return sanitizeWeekDetailRows(rows).map((row) =>
    // Recalculate Comm % (50% only if FINAL NET >= 1 and AP > 0) and dependents.
    recalculateWeeklyDetailRow(row),
  );
}

/**
 * Finalize an uploaded base Week Detail:
 * keep uploaded values (no formulas). Next Week NCF from the file is the
 * carry-over seed for the following week.
 */
export function finalizeBaseWeekDetail(
  rows: string[][],
  uploadedNextNcf: string[],
): string[][] {
  const sanitized = sanitizeWeekDetailRows(rows);
  const iNextNcf = idx(
    colMap(WEEKLY_DETAIL_COLUMNS),
    "Next Week Negative Carry Over",
    "Next Week NCF",
  );
  if (iNextNcf < 0) return sanitized;

  return sanitized.map((row, index) => {
    const uploaded = String(uploadedNextNcf[index] ?? "").trim();
    if (!uploaded) return row;
    const next = [...row];
    next[iNextNcf] = fmt(roundExcel(toNumber(uploaded)));
    return next;
  });
}

/**
 * Copy previous week's Next Week Negative Carry Over into this week's
 * Last Week Negative Carry Over for every matching affiliate, then recalculate.
 * Keeps negatives flowing week-to-week until FINAL NET clears them.
 */
export function applyNegativeCarryOverFromPrev(
  weekRows: string[][],
  prevWeekRows: string[][],
): string[][] {
  if (weekRows.length === 0) return weekRows;

  const cols = colMap(WEEKLY_DETAIL_COLUMNS);
  const iUser = idx(cols, "Affiliate Username");
  const iLastNcf = idx(cols, "Last Week Negative Carry Over", "Last Week NCF");
  const iNextNcf = idx(cols, "Next Week Negative Carry Over", "Next Week NCF");
  if (iUser < 0 || iLastNcf < 0 || iNextNcf < 0) {
    return normalizeWeekDetailStatuses(weekRows);
  }

  const prevNextByUser = new Map<string, number>();
  for (const row of prevWeekRows) {
    const username = cell(row, iUser);
    if (!username) continue;
    prevNextByUser.set(username.toLowerCase(), roundExcel(toNumber(row[iNextNcf])));
  }

  return weekRows.map((row) => {
    const base =
      row.length > WEEKLY_DETAIL_COLUMNS.length ? row.slice(1) : [...row];
    while (base.length < WEEKLY_DETAIL_COLUMNS.length) base.push("");
    const username = cell(base, iUser).toLowerCase();
    const carry = username ? (prevNextByUser.get(username) ?? 0) : 0;
    base[iLastNcf] = fmt(carry);
    base[idx(cols, "Status")] = normalizePaymentStatus(base[idx(cols, "Status")]);
    return recalculateWeeklyDetailRow(base);
  });
}

/** True when Last/Next NCF or FINAL NET / Calculated Comm changed (carry sync). */
export function weekDetailCarryChanged(
  before: string[][],
  after: string[][],
): boolean {
  if (before.length !== after.length) return true;
  const cols = colMap(WEEKLY_DETAIL_COLUMNS);
  const watch = [
    idx(cols, "Last Week Negative Carry Over", "Last Week NCF"),
    idx(cols, "Next Week Negative Carry Over", "Next Week NCF"),
    idx(cols, "FINAL NET"),
    idx(cols, "Calculated Commission"),
    idx(cols, "Difference"),
  ].filter((i) => i >= 0);

  for (let r = 0; r < after.length; r += 1) {
    for (const c of watch) {
      if (toNumber(before[r]?.[c]) !== toNumber(after[r]?.[c])) return true;
    }
  }
  return false;
}

export function derivePaidComm(week: string, weeklyDetail: string[][]): string[][] {
  const cols = colMap(WEEKLY_DETAIL_COLUMNS);
  const iStatus = idx(cols, "Status");
  const iUser = idx(cols, "Affiliate Username");
  const iAdj = idx(cols, "Adjustment");
  const iFinal = idx(cols, "Final Commission");
  return weeklyDetail
    .filter((row) => isPaidStatus(row[iStatus]))
    .map((row) => [
      week,
      String(row[iUser] ?? ""),
      "Paid",
      String(row[iAdj] ?? ""),
      String(row[iFinal] ?? ""),
    ]);
}

/**
 * Guideline WEEKLY SUMMARY TAB aggregates for one week.
 */
/** Total of the Final Commission column across Week Detail rows. */
export function sumWeekDetailFinalCommission(weekDetail: string[][]): number {
  const iFinal = idx(colMap(WEEKLY_DETAIL_COLUMNS), "Final Commission");
  if (iFinal < 0) return 0;
  return weekDetail.reduce((sum, row) => sum + toNumber(row[iFinal]), 0);
}

export function computeWeeklyKpi(params: {
  week: string;
  sources: Bundle;
  paidComm: string[][];
  weekDetail?: string[][];
  prevTotalAff?: number;
}): string[] {
  const { week, sources, paidComm, prevTotalAff = 0 } = params;
  const affSu = sources["aff-su"] ?? [];
  const affRaw = sources["aff-raw-upload"] ?? [];
  const businessRaw = sources["business-raw"] ?? [];

  const affSuCols = colMap(TAB_COLUMNS["aff-su"]);
  const affRawCols = colMap(TAB_COLUMNS["aff-raw-upload"]);
  const bizCols = colMap(TAB_COLUMNS["business-raw"]);
  const paidCols = colMap(TAB_COLUMNS["paid-comm"]);

  const suMonth = idx(affSuCols, "Month");
  const suStructure = idx(affSuCols, "Commission Structure");
  const arMonth = idx(affRawCols, "Month");
  const arCurrency = idx(affRawCols, "Currency");
  const arAp = idx(affRawCols, "Active Players");
  const arDeposit = idx(affRawCols, "Total Deposit");
  const arTurnover = idx(affRawCols, "Total Turnover");
  const arSports = idx(affRawCols, "Sports Total Turnover");
  const arLive = idx(affRawCols, "Live Casino Total Turnover");
  const arSlots = idx(affRawCols, "Slots Total Turnover");
  const arTable = idx(affRawCols, "Table Total Turnover");
  const arGross = idx(affRawCols, "Total Profit&Loss", "Total Profit & Loss");
  const arDeduction = idx(affRawCols, "Total Deduction");
  const arBonus = idx(affRawCols, "Total Bonus");
  const arVip = idx(affRawCols, "VIP Cash Bonus");
  const arNet = idx(affRawCols, "Total Net Profit");

  const pcMonth = idx(paidCols, "Month");
  const pcFinal = idx(paidCols, "Final Comm");

  const bizDate = idx(bizCols, "Date");
  const bizAp = idx(bizCols, "Active Player");
  const bizTo = idx(bizCols, "Turnover");
  const bizGross = idx(bizCols, "Gross Revenue");
  const bizBonus = idx(bizCols, "Bonus");

  // New Sign Up (guideline):
  //   COUNTIFS('Aff SU'!O:O,"<Market> Affiliates BDT Weekly(BDT)",'Aff SU'!A:A,week)
  // Count Aff SU rows for the week whose Commission Structure is the weekly
  // BDT affiliate program. Matched via the "Weekly(BDT)" suffix so every BDT
  // market works, not just TK.
  const weekSu = affSu.filter(
    (row) =>
      cell(row, suMonth).toUpperCase() === week.toUpperCase() &&
      cell(row, suStructure)
        .toLowerCase()
        .replace(/\s+/g, "")
        .includes("weekly(bdt)"),
  );
  const weekAff = affRaw.filter((row) => cell(row, arMonth).toUpperCase() === week.toUpperCase());
  const weekPaid = paidComm.filter((row) => cell(row, pcMonth).toUpperCase() === week.toUpperCase());
  const weekBiz =
    businessRaw.find((row) => cell(row, bizDate).toUpperCase() === week.toUpperCase()) ??
    businessRaw[0];

  const newSignUp = weekSu.length;
  const totalAff = prevTotalAff > 0 ? prevTotalAff + newSignUp : newSignUp;

  // Guideline filters Currency vs "BDT" (cell A3 in Excel). For TK BDT market use BDT.
  const bdtAff = weekAff.filter((row) => {
    const currency = cell(row, arCurrency).toUpperCase();
    return !currency || currency.includes("BDT");
  });

  // Active Affiliates >5 Player (guideline):
  //   COUNTIFS('Aff RawW'!A:A,week,'Aff RawW'!F:F,"BDT",'Aff RawW'!K:K,">=5")
  //   Month = week, Currency = BDT, Active Players >= 5
  const activeGe5 = bdtAff.filter((row) => toNumber(row[arAp]) >= 5).length;
  const activeLt5 = bdtAff.filter((row) => {
    const ap = toNumber(row[arAp]);
    return ap > 0 && ap < 5;
  }).length;
  // Dormant Aff = Total Aff − Active >5 Player − Active <5 Players
  const dormant = totalAff - activeGe5 - activeLt5;

  const activePlayers = sumCol(weekAff, arAp);
  const deposit = sumCol(weekAff, arDeposit);
  const totalTurnover = sumCol(weekAff, arTurnover);
  const sports = sumCol(weekAff, arSports);
  const liveCasino = sumCol(weekAff, arLive);
  const slots = sumCol(weekAff, arSlots);
  const table = sumCol(weekAff, arTable);
  const others = totalTurnover - (sports + liveCasino + slots + table);
  const grossRevenue = sumCol(weekAff, arGross);
  const deduction = sumCol(weekAff, arDeduction);
  const bonus = sumCol(weekAff, arBonus);
  const vip = sumCol(weekAff, arVip);
  const net = sumCol(weekAff, arNet);
  // Commission (guideline):
  //   SUMIFS('Paid Comm'!E:E,'Paid Comm'!A:A,week)
  //   Sum the Final Comm column of Paid Comm rows for this week.
  const commission = sumCol(weekPaid, pcFinal);
  // Guideline formula: Commission / Net = IF(Net = 0, 0, Commission / Net)
  const commissionOverNet = net === 0 ? 0 : commission / net;

  const bAp = toNumber(weekBiz?.[bizAp]);
  const bTo = toNumber(weekBiz?.[bizTo]);
  const bGross = toNumber(weekBiz?.[bizGross]);
  const bBonus = toNumber(weekBiz?.[bizBonus]);

  return [
    week,
    String(newSignUp),
    String(totalAff),
    String(activeGe5),
    String(activeLt5),
    String(dormant),
    fmt(activePlayers),
    fmt(deposit),
    fmt(totalTurnover),
    fmt(sports),
    fmt(liveCasino),
    fmt(slots),
    fmt(table),
    fmt(others),
    fmt(grossRevenue),
    fmt(deduction),
    fmt(bonus),
    fmt(vip),
    fmt(net),
    fmtMoney(commission),
    `${Math.round(commissionOverNet * 100)}%`,
    "",
    // Ratios = (KPI value / Business Raw value) × 100, shown as a percentage.
    bAp ? `${Math.round((activePlayers / bAp) * 100)}%` : "",
    bTo ? `${Math.round((totalTurnover / bTo) * 100)}%` : "",
    bGross ? `${Math.round((grossRevenue / bGross) * 100)}%` : "",
    bBonus ? `${Math.round((bonus / bBonus) * 100)}%` : "",
  ];
}

/**
 * New Sign Up per week, computed directly from the (all-weeks) Aff SU dataset.
 *
 * Mirrors the Excel formula used in computeWeeklyKpi:
 *   COUNTIFS('Aff SU'!O:O,"<Market> Affiliates BDT Weekly(BDT)",'Aff SU'!A:A,week)
 *
 * Used to refresh the New Sign Up column for ALL weeks on display, so historical
 * weeks are not left with stale zeros when only the current week is re-uploaded.
 */
export function normalizeWeeklySummaryNumeric(raw: string): string {
  const cleaned = String(raw).replace(/,/g, "").trim();
  const paren = /^\(\s*([\d.]+)\s*\)$/.exec(cleaned);
  if (paren) return String(-Math.abs(Number(paren[1]) || 0));
  const n = Number(cleaned);
  return Number.isFinite(n) && cleaned !== "" ? String(n) : cleaned;
}

function dormantAffFromRow(row: string[], cols: Map<string, number>): number {
  const totalAff = toNumber(row[idx(cols, "Total Aff")]);
  const activeGe5 = toNumber(row[idx(cols, "Active Affiliates >5 Player")]);
  const activeLt5 = toNumber(row[idx(cols, "Active Affiliates <5 Players")]);
  return totalAff - activeGe5 - activeLt5;
}

/**
 * Apply an admin edit to Total Aff or Dormant Aff on Weekly Summary.
 * Total Aff edits recalc Dormant Aff for that week and cascade cumulative
 * Total Aff (+ Dormant) to all later weeks.
 */
export function applyWeeklySummaryAffCellEdit(
  allRows: string[][],
  editedWeek: string,
  column: "Total Aff" | "Dormant Aff",
  rawValue: string,
): string[][] {
  const cols = colMap(WEEKLY_KPI_COLUMNS);
  const colIndex = WEEKLY_KPI_COLUMNS.indexOf(column);
  const iNewSignUp = idx(cols, "New Sign Up");
  const iTotal = idx(cols, "Total Aff");
  const iDormant = idx(cols, "Dormant Aff");
  if (colIndex < 0) return allRows;

  const byWeek = new Map<string, string[]>();
  for (const row of allRows) {
    const wk = String(row[0] ?? "")
      .trim()
      .toUpperCase();
    if (!wk) continue;
    const copy = [...row];
    while (copy.length < WEEKLY_KPI_COLUMNS.length) copy.push("");
    byWeek.set(wk, copy);
  }

  const sortedWeeks = [...byWeek.keys()].sort((a, b) => a.localeCompare(b));
  const editWk = editedWeek.trim().toUpperCase();
  const editIdx = sortedWeeks.indexOf(editWk);
  if (editIdx < 0) return allRows;

  const row = byWeek.get(editWk)!;
  row[colIndex] = normalizeWeeklySummaryNumeric(rawValue);

  if (column === "Total Aff" && iDormant >= 0) {
    row[iDormant] = String(dormantAffFromRow(row, cols));
    byWeek.set(editWk, row);

    for (let i = editIdx + 1; i < sortedWeeks.length; i += 1) {
      const wk = sortedWeeks[i]!;
      const nextRow = byWeek.get(wk)!;
      const prevTotal = toNumber(byWeek.get(sortedWeeks[i - 1]!)![iTotal]);
      const newSignUp = toNumber(nextRow[iNewSignUp]);
      const totalAff = prevTotal + newSignUp;
      nextRow[iTotal] = String(totalAff);
      nextRow[iDormant] = String(dormantAffFromRow(nextRow, cols));
      byWeek.set(wk, nextRow);
    }
  }

  return sortedWeeks.map((wk) => byWeek.get(wk)!);
}

export function computeNewSignUpByWeek(affSuRows: string[][]): Map<string, number> {
  const affSuCols = colMap(TAB_COLUMNS["aff-su"]);
  const suMonth = idx(affSuCols, "Month");
  const suStructure = idx(affSuCols, "Commission Structure");

  const byWeek = new Map<string, number>();
  for (const row of affSuRows) {
    const week = cell(row, suMonth).toUpperCase();
    if (!week) continue;
    const structure = cell(row, suStructure)
      .toLowerCase()
      .replace(/\s+/g, "");
    if (!structure.includes("weekly(bdt)")) continue;
    byWeek.set(week, (byWeek.get(week) ?? 0) + 1);
  }
  return byWeek;
}

export { WEEKLY_KPI_COLUMNS };
