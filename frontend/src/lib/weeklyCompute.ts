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
  const raw = String(value ?? "")
    .replace(/,/g, "")
    .replace(/%/g, "")
    .trim();
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
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

function formatSuMonth(suDateRaw: string): string {
  if (!suDateRaw) return "";
  if (/^\d{6}$/.test(suDateRaw)) return suDateRaw;
  const date = new Date(suDateRaw);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function fmt(n: number): string {
  return String(Number(n.toFixed(6)));
}

type Bundle = Partial<Record<ReportTabId, string[][]>>;

/**
 * Guideline FINAL NET:
 * - If NCF + Net Profit < 0 → NCF + Net Profit
 * - If NCF + Net Profit > 0 → 0
 */
export function computeFinalNet(lastWeekNcf: number, netProfit: number): number {
  const sum = lastWeekNcf + netProfit;
  return sum > 0 ? 0 : sum;
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
 * Comm % (TK BDT): AP > 0 and FINAL NET > 1 → 50%, else 0%.
 * (Guideline note: percentage differs per brand/market.)
 */
export function computeCommPct(ap: number, finalNet: number): number {
  return ap > 0 && finalNet > 1 ? 0.5 : 0;
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
  const iAp = idx(cols, "AP(TO>0)", "AP (TO>0)");
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
  const lastWeekNcf = toNumber(next[iLastNcf]);

  const deduction = computeDeduction(grossRevenue);
  const netProfit = computeNetProfit(totalProfitLoss, deduction, affRawBonus, vipCashBonus);
  const finalNet = computeFinalNet(lastWeekNcf, netProfit);
  const commPct = computeCommPct(ap, finalNet);
  const calculatedCommission = finalNet * commPct;
  const finalCommission = systemCommission + adjustment;
  const difference = calculatedCommission - systemCommission;
  const nextWeekNcf = finalNet < 0 ? finalNet : 0;

  next[iDed] = fmt(deduction);
  next[iTpl] = fmt(totalProfitLoss);
  next[iNetProfit] = fmt(netProfit);
  next[iFinalNet] = fmt(finalNet);
  next[iComm] = String(commPct);
  next[iCalc] = fmt(calculatedCommission);
  next[iFinal] = fmt(finalCommission);
  next[iDiff] = fmt(difference);
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
  const suDate = idx(affSuCols, "SU Date");

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

  const affSuByUser = new Map<string, string[]>();
  const usernames: string[] = [];
  const seen = new Set<string>();

  for (const row of affSu) {
    const username = cell(row, suUser);
    if (!username) continue;
    const lower = username.toLowerCase();
    if (!affSuByUser.has(lower)) affSuByUser.set(lower, row);
    if (!seen.has(lower)) {
      seen.add(lower);
      usernames.push(username);
    }
  }

  for (const row of affRaw) {
    if (cell(row, arMonth).toUpperCase() !== week.toUpperCase()) continue;
    const username = cell(row, arUser);
    if (!username) continue;
    const lower = username.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    usernames.push(username);
  }

  const out: string[][] = [];

  for (const username of usernames) {
    const lower = username.toLowerCase();
    const affRows = affRawIdx.get(key2(week, username));
    const playerRows = playerIdx.get(key2(week, username));
    const systemRows = systemIdx.get(key2(week, username));
    const paidRows = paidIdx.get(key2(week, username));
    const prev = prevByUser.get(lower);
    const su = affSuByUser.get(lower);

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
    const netProfit = computeNetProfit(totalProfitLoss, deduction, affRawBonus, vipCashBonus);
    const lastWeekNcf = toNumber(cell(prev, wNextNcf));
    const finalNet = computeFinalNet(lastWeekNcf, netProfit);
    const commPct = computeCommPct(ap, finalNet);
    const calculatedCommission = finalNet * commPct;
    const finalCommission = systemCommission + adjustment;
    const difference = calculatedCommission - systemCommission;
    const lastWeekCommission = toNumber(cell(prev, wFinal));
    const nextWeekNcf = finalNet < 0 ? finalNet : 0;

    out.push([
      formatSuMonth(cell(su, suDate)),
      week,
      username,
      status,
      adjustment ? String(adjustment) : "",
      fmt(finalCommission),
      fmt(difference),
      fmt(systemCommission),
      fmt(calculatedCommission),
      String(commPct),
      fmt(lastWeekCommission),
      String(ap),
      String(apQualified),
      fmt(grossRevenue),
      fmt(deduction),
      fmt(affRawBonus),
      fmt(playerRawBonus),
      fmt(vipCashBonus),
      fmt(netRevenue),
      fmt(totalProfitLoss),
      fmt(netProfit),
      fmt(finalNet),
      fmt(lastWeekNcf),
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

export function normalizeWeekDetailStatuses(rows: string[][]): string[][] {
  return rows.map((row) => {
    const next = [...row];
    while (next.length < 4) next.push("");
    next[3] = normalizePaymentStatus(next[3]);
    return next;
  });
}

export function derivePaidComm(week: string, weeklyDetail: string[][]): string[][] {
  return weeklyDetail
    .filter((row) => isPaidStatus(row[3]))
    .map((row) => [
      week,
      String(row[2] ?? ""),
      "Paid",
      String(row[4] ?? ""),
      String(row[5] ?? ""),
    ]);
}

/**
 * Guideline WEEKLY SUMMARY TAB aggregates for one week.
 */
export function computeWeeklyKpi(params: {
  week: string;
  sources: Bundle;
  paidComm: string[][];
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

  const weekSu = affSu.filter((row) => cell(row, suMonth).toUpperCase() === week.toUpperCase());
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

  const activeGe5 = bdtAff.filter((row) => toNumber(row[arAp]) > 5).length;
  const activeLt5 = bdtAff.filter((row) => {
    const ap = toNumber(row[arAp]);
    return ap > 0 && ap < 5;
  }).length;
  const dormant = Math.max(0, totalAff - activeGe5 - activeLt5);

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
  const commission = sumCol(weekPaid, pcFinal);
  // Guideline: If Net > 0 then 0, else commission / Net
  const commissionOverNet = net > 0 ? 0 : net === 0 ? 0 : commission / net;

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
    fmt(commission),
    fmt(commissionOverNet),
    "",
    bAp ? fmt(activePlayers / bAp) : "",
    bTo ? fmt(totalTurnover / bTo) : "",
    bGross ? fmt(grossRevenue / bGross) : "",
    bBonus ? fmt(bonus / bBonus) : "",
  ];
}

export { WEEKLY_KPI_COLUMNS };
