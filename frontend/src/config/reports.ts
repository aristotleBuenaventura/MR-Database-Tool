/**
 * Column layouts and formula rules from:
 * MR Database Source List.xlsx (TK BDT guideline)
 */

export type ReportPeriod = "weekly" | "monthly";

export type Market = {
  id: string;
  label: string;
  period: ReportPeriod;
};

export type ReportTabId =
  | "week-detail"
  | "weekly-summary"
  | "paid-comm"
  | "bad-aff"
  | "adjustment-notes"
  | "system-comm-raw"
  | "aff-raw-upload"
  | "player-raw-upload"
  | "business-raw"
  | "aff-su"
  | "promo-ended"
  | "history"
  | "database";

export type ReportTab = {
  id: ReportTabId;
  label: string;
};

export const WEEKLY_MARKETS: Market[] = [
  { id: "m1-bdt", label: "M1 BDT", period: "weekly" },
  { id: "m2-bdt", label: "M2 BDT", period: "weekly" },
  { id: "b1-bdt", label: "B1 BDT", period: "weekly" },
  { id: "b2-bdt", label: "B2 BDT", period: "weekly" },
  { id: "k1-bdt", label: "K1 BDT", period: "weekly" },
  { id: "b3-bdt", label: "B3 BDT", period: "weekly" },
  { id: "b4-bdt", label: "B4 BDT", period: "weekly" },
  { id: "tk-bdt", label: "TK BDT", period: "weekly" },
  { id: "b5-bdt", label: "B5 BDT", period: "weekly" },
  { id: "jw-bdt", label: "JW BDT", period: "weekly" },
];

/** M1/M2 Regular Weekly markets that have a Promo Weekly submenu. */
export const PROMO_PARENT_MARKET_IDS = new Set(["m1-bdt", "m2-bdt"]);

export const PROMO_WEEKLY_MARKETS: Market[] = [
  { id: "m1-bdt-promo", label: "M1 BDT Promo Weekly", period: "weekly" },
  { id: "m2-bdt-promo", label: "M2 BDT Promo Weekly", period: "weekly" },
];

export const ALL_WEEKLY_MARKETS: Market[] = [
  ...WEEKLY_MARKETS,
  ...PROMO_WEEKLY_MARKETS,
];

export function promoWeeklyMarketId(regularId: string): string {
  return `${regularId.trim().toLowerCase()}-promo`;
}

export function regularWeeklyMarketId(
  marketId: string | null | undefined,
): string {
  return String(marketId ?? "")
    .trim()
    .toLowerCase()
    .replace(/-promo$/, "");
}

export function isPromoWeeklyMarket(
  marketId: string | null | undefined,
): boolean {
  const id = String(marketId ?? "")
    .trim()
    .toLowerCase();
  return id.endsWith("-promo") && PROMO_PARENT_MARKET_IDS.has(regularWeeklyMarketId(id));
}

export function marketHasPromoSubmenu(
  marketId: string | null | undefined,
): boolean {
  const id = String(marketId ?? "")
    .trim()
    .toLowerCase();
  return PROMO_PARENT_MARKET_IDS.has(id) || isPromoWeeklyMarket(id);
}

/** The other roster (Regular ↔ Promo), or null when the brand has no promo split. */
export function partnerWeeklyMarketId(
  marketId: string | null | undefined,
): string | null {
  const id = String(marketId ?? "")
    .trim()
    .toLowerCase();
  if (!id) return null;
  if (isPromoWeeklyMarket(id)) return regularWeeklyMarketId(id);
  if (PROMO_PARENT_MARKET_IDS.has(id)) return promoWeeklyMarketId(id);
  return null;
}

export function findWeeklyMarket(
  marketId: string | null | undefined,
): Market | undefined {
  const id = String(marketId ?? "").trim();
  return ALL_WEEKLY_MARKETS.find((item) => item.id === id);
}

/** B1/B2/K1/TK — flat 50% when FINAL NET >= 1 and AP > 0; 18% deduction. */
export type CommissionCalcProfile = "standard" | "b3-b4-tiered";

const MARKET_COMMISSION_PROFILE: Partial<Record<string, CommissionCalcProfile>> = {
  "b3-bdt": "b3-b4-tiered",
  "b4-bdt": "b3-b4-tiered",
};

export function commissionCalcProfileForMarket(
  marketId: string | null | undefined,
): CommissionCalcProfile {
  const id = String(marketId ?? "").trim();
  return MARKET_COMMISSION_PROFILE[id] ?? "standard";
}

/** B5 / JW: Week Detail TPL = Gross + Recycle Amount + Cancel Fee from Aff Raw. */
const RECYCLE_CANCEL_MARKET_IDS = new Set(["b5-bdt", "jw-bdt"]);

export function marketUsesRecycleCancel(
  marketId: string | null | undefined,
): boolean {
  return RECYCLE_CANCEL_MARKET_IDS.has(String(marketId ?? "").trim().toLowerCase());
}

export const WEEKLY_DETAIL_RECYCLE_COLUMNS = [
  "Recycle Amount",
  "Cancel Fee",
] as const;

export const MONTHLY_MARKETS: Market[] = [
  { id: "m1-bdt-monthly", label: "M1 BDT", period: "monthly" },
];

export function monthlyMarketId(regularId: string): string {
  return `${regularId.trim().toLowerCase()}-monthly`;
}

export function weeklyMarketIdFromMonthly(
  marketId: string | null | undefined,
): string {
  return String(marketId ?? "")
    .trim()
    .toLowerCase()
    .replace(/-monthly$/, "");
}

export function findMonthlyMarket(
  marketId: string | null | undefined,
): Market | undefined {
  const id = String(marketId ?? "").trim();
  return MONTHLY_MARKETS.find((item) => item.id === id);
}

/** Monthly market linked to a weekly brand (e.g. m1-bdt → m1-bdt-monthly). */
export function monthlyMarketForWeekly(
  weeklyId: string | null | undefined,
): Market | undefined {
  const id = String(weeklyId ?? "")
    .trim()
    .toLowerCase();
  if (!id) return undefined;
  return (
    findMonthlyMarket(monthlyMarketId(id)) ??
    MONTHLY_MARKETS.find(
      (item) => weeklyMarketIdFromMonthly(item.id) === id,
    )
  );
}

/** Brands that show Weekly / Monthly under Summary. */
export function marketHasMonthlySummarySubmenu(
  marketId: string | null | undefined,
): boolean {
  const id = regularWeeklyMarketId(marketId);
  return Boolean(monthlyMarketForWeekly(id));
}

export function findMarket(
  marketId: string | null | undefined,
): Market | undefined {
  const id = String(marketId ?? "").trim();
  return findWeeklyMarket(id) ?? findMonthlyMarket(id);
}

export function isMonthlyMarket(
  marketId: string | null | undefined,
): boolean {
  return findMarket(marketId)?.period === "monthly";
}

/** User-facing week/month words. Internal tab IDs stay week-detail / weekly-summary. */
export function periodCopy(marketId?: string | null) {
  const monthly = isMonthlyMarket(marketId);
  const Week = monthly ? "Month" : "Week";
  const week = monthly ? "month" : "week";
  const weeks = monthly ? "months" : "weeks";
  const Weekly = monthly ? "Monthly" : "Weekly";
  const weekly = monthly ? "monthly" : "weekly";
  return {
    monthly,
    Week,
    week,
    weeks,
    Weekly,
    weekly,
    detail: `${Week} Detail`,
    summary: `${Weekly} Summary`,
    ncf: `Last ${Week} NCF`,
    periodKey: monthly ? "Month" : "Month/Week",
    Weeks: monthly ? "Months" : "Weeks",
    /** Example period code for toasts / placeholders. */
    exampleCode: monthly ? "202610" : "2026W33",
  };
}

/** Rewrite API / toast copy so monthly markets say month instead of week. */
export function periodizeUserMessage(
  message: string,
  marketId?: string | null,
): string {
  const words = periodCopy(marketId);
  if (!words.monthly || !message) return message;
  return message
    .replace(/\bWeekly\b/g, words.Weekly)
    .replace(/\bweekly\b/g, words.weekly)
    .replace(/\bWeeks\b/g, words.Weeks)
    .replace(/\bweeks\b/g, words.weeks)
    .replace(/\bWeek\b/g, words.Week)
    .replace(/(?<!')\bweek\b(?!')/g, words.week);
}

export function userErrorMessage(
  error: unknown,
  fallback: string,
  marketId?: string | null,
): string {
  const raw =
    error instanceof Error && error.message.trim()
      ? error.message
      : fallback;
  return periodizeUserMessage(raw, marketId);
}

const WEEK_TO_MONTH_COLUMNS: Record<string, string> = {
  Week: "Month",
  "Last Week Commission": "Last Month Commission",
  "Last Week Negative Carry Over": "Last Month Negative Carry Over",
  "Next Week Negative Carry Over": "Next Month Negative Carry Over",
};

export function periodizeDetailColumn(
  column: string,
  marketId?: string | null,
): string {
  if (!isMonthlyMarket(marketId)) return column;
  return WEEK_TO_MONTH_COLUMNS[column] ?? column;
}

export function periodizeDetailColumns(
  columns: readonly string[],
  marketId?: string | null,
): string[] {
  return columns.map((column) => periodizeDetailColumn(column, marketId));
}

/** Order matches guideline / sample workbook: week detail first, then sources, then Weekly Summary. */
export const REPORT_TABS: ReportTab[] = [
  { id: "week-detail", label: "Week Detail" },
  { id: "aff-raw-upload", label: "Aff Raw Upload" },
  { id: "player-raw-upload", label: "Player Raw Upload" },
  { id: "system-comm-raw", label: "System Comm Raw" },
  { id: "weekly-summary", label: "Weekly Summary" },
  { id: "paid-comm", label: "Paid Comm" },
  { id: "bad-aff", label: "Bad Aff" },
  { id: "adjustment-notes", label: "Adjustment Notes" },
  { id: "aff-su", label: "AFF SU" },
  { id: "business-raw", label: "Business Raw" },
  { id: "promo-ended", label: "Promo Ended" },
  { id: "history", label: "History" },
  { id: "database", label: "Database" },
];

/** Promo shows these tabs but reads/writes Regular's copy (one BRAW, no doubled numbers). */
export const PROMO_SHARED_FROM_REGULAR_TAB_IDS = new Set<ReportTabId>([
  "weekly-summary",
  "business-raw",
]);

export function storageMarketIdForTab(
  marketId: string | null | undefined,
  tabId: ReportTabId,
): string {
  const id = String(marketId ?? "").trim();
  if (!id || !PROMO_SHARED_FROM_REGULAR_TAB_IDS.has(tabId)) return id;
  if (!isPromoWeeklyMarket(id)) return id;
  return regularWeeklyMarketId(id) || id;
}

export function reportTabsForMarket(
  marketId: string | null | undefined,
): ReportTab[] {
  const words = periodCopy(marketId);
  const tabs = isPromoWeeklyMarket(marketId)
    ? REPORT_TABS
    : REPORT_TABS.filter((tab) => tab.id !== "promo-ended");
  if (!words.monthly) return tabs;
  return tabs.map((tab) => {
    if (tab.id === "week-detail") return { ...tab, label: words.detail };
    if (tab.id === "weekly-summary") return { ...tab, label: words.summary };
    return tab;
  });
}

export function labelForTab(
  tabId: ReportTabId,
  marketId?: string | null,
): string {
  return (
    reportTabsForMarket(marketId).find((tab) => tab.id === tabId)?.label ??
    REPORT_TABS.find((tab) => tab.id === tabId)?.label ??
    tabId
  );
}

export const WEEK_OPTIONS = [
  "2026W26",
  "2026W25",
  "2026W24",
  "2026W23",
  "2026W22",
  "2026W21",
  "2026W20",
  "2026W19",
  "2026W18",
];

/** Per-week tab (= guideline "2026W26 TAB"). Status / Adjustment / Last Week NCF are editable. */
export const WEEKLY_DETAIL_COLUMNS = [
  "Week",
  "Affiliate Username",
  "Status",
  "Adjustment",
  "Final Commission",
  "Difference",
  "System Commission",
  "Calculated Commission",
  "Comm %",
  "Last Week Commission",
  "AP(TO>0)",
  "AP Qualified (TO>3000)",
  "Gross Revenue",
  "Deduction",
  "Aff Raw Bonus",
  "Player Raw Bonus",
  "VIP Cash Bonus",
  "Net Revenue",
  "Total Profit & Loss",
  "Net Profit",
  "FINAL NET",
  "Last Week Negative Carry Over",
  "Next Week Negative Carry Over",
] as const;

export const WEEKLY_EDITABLE_COLUMNS = new Set([
  "Status",
  "Adjustment",
  "Last Week Negative Carry Over",
  "Last Month Negative Carry Over",
]);

/** Week Detail / Adjustment Notes layout. Recycle + Cancel only for B5 and JW, unless a saved profile says otherwise. */
export function weekDetailColumnsForMarket(
  marketId?: string | null,
  totalProfitLoss?: "gross" | "gross-recycle-cancel" | null,
): string[] {
  const useRecycle =
    totalProfitLoss === "gross-recycle-cancel" ||
    (totalProfitLoss !== "gross" && marketUsesRecycleCancel(marketId));
  if (!useRecycle) return periodizeDetailColumns(WEEKLY_DETAIL_COLUMNS, marketId);
  const columns: string[] = [...WEEKLY_DETAIL_COLUMNS];
  const insertAt = columns.indexOf("Gross Revenue") + 1;
  columns.splice(insertAt, 0, ...WEEKLY_DETAIL_RECYCLE_COLUMNS);
  return periodizeDetailColumns(columns, marketId);
}

export function badAffColumnsForMarket(
  marketId?: string | null,
  totalProfitLoss?: "gross" | "gross-recycle-cancel" | null,
): string[] {
  return weekDetailColumnsForMarket(marketId, totalProfitLoss).filter(
    (column) => column !== "Status",
  );
}

function normalizeColumnKey(column: string): string {
  return column
    .toLowerCase()
    .replace(/[\n\r]+/g, " ")
    .replace(/[%&]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Money columns — keep/display 2 decimals (no whole-number roundoff). */
export const MONEY_DISPLAY_COLUMNS = new Set([
  "Adjustment",
  "Final Commission",
  "Final Comm",
  "Difference",
  "System Commission",
  "Calculated Commission",
  "Last Week Commission",
  "Last Month Commission",
  "Gross Revenue",
  "Recycle Amount",
  "Cancel Fee",
  "Deduction",
  "Aff Raw Bonus",
  "Player Raw Bonus",
  "VIP Cash Bonus",
  "Net Revenue",
  "Total Profit & Loss",
  "Net Profit",
  "FINAL NET",
  "Last Week Negative Carry Over",
  "Next Week Negative Carry Over",
  "Last Month Negative Carry Over",
  "Next Month Negative Carry Over",
  "Deposit",
  "Total Turnover",
  "Sports",
  "Live Casino",
  "Slots",
  "Table",
  "Others",
  "Commission",
  "Net",
  "Bonus",
  "Total Stake",
  "Total Profit&Loss",
  "Total Recycle Amount",
  "Total Cancel Fee",
]);

/** Game split columns on Weekly Summary sit between Total Turnover and Gross Revenue. */
export function isWeeklyKpiSplitColumn(
  column: string,
  allColumns: readonly string[],
): boolean {
  const key = normalizeColumnKey(column);
  if (!key || key === "total turnover" || key === "gross revenue") return false;
  const to = allColumns.findIndex((item) => normalizeColumnKey(item) === "total turnover");
  const gross = allColumns.findIndex((item) => normalizeColumnKey(item) === "gross revenue");
  const index = allColumns.indexOf(column);
  return to >= 0 && gross > to && index > to && index < gross;
}

/** Fixed money columns plus per-game Stake / Turnover / P&L from raw uploads. */
export function isMoneyDisplayColumn(
  column: string,
  allColumns?: readonly string[],
): boolean {
  if (MONEY_DISPLAY_COLUMNS.has(column) || column === "FINAL NET") return true;
  if (allColumns && isWeeklyKpiSplitColumn(column, allColumns)) return true;
  const key = normalizeColumnKey(column);
  return (
    key === "total stake" ||
    key === "total turnover" ||
    key === "total profit loss" ||
    key.endsWith(" total stake") ||
    key.endsWith(" total turnover") ||
    key.endsWith(" total profit loss") ||
    key.endsWith(" total profit and loss")
  );
}

/** Weekly Summary KPI columns editable by admin (import/export role). */
export const WEEKLY_SUMMARY_EDITABLE_COLUMNS = new Set([
  "Total Aff",
  "Dormant Aff",
]);

/** Editable Status on Week Detail: Paid / Unpaid / Reject (Reject deletes the row). */
export const WEEKLY_STATUS_TOGGLE_COLUMNS = new Set(["Status"]);

/** Guideline WEEKLY SUMMARY TAB (KPI aggregates). */
export const WEEKLY_KPI_LEAD_COLUMNS = [
  "Month",
  "New Sign Up",
  "Total Aff",
  "Active Affiliates >5 Player",
  "Active Affiliates <5 Players",
  "Dormant Aff",
  "Active Players",
  "Deposit",
  "Total Turnover",
] as const;

/** Fallback turnover split when the Aff Raw file has no per-game Total Turnover columns. */
export const WEEKLY_KPI_DEFAULT_GAME_COLUMNS = [
  "Sports",
  "Live Casino",
  "Slots",
  "Table",
  "Others",
] as const;

export const WEEKLY_KPI_TRAIL_COLUMNS = [
  "Gross Revenue",
  "Deduction",
  "Bonus",
  "VIP Cash Bonus",
  "Net",
  "Commission",
  "Commission / Net",
  "Affiliate Campaign",
  "Active Player Ratio",
  "Turnover Ratio",
  "Gross Ratio",
  "Bonus Ratio",
] as const;

export const WEEKLY_KPI_COLUMNS = [
  ...WEEKLY_KPI_LEAD_COLUMNS,
  ...WEEKLY_KPI_DEFAULT_GAME_COLUMNS,
  ...WEEKLY_KPI_TRAIL_COLUMNS,
] as const;

export const TAB_COLUMNS: Record<
  Exclude<ReportTabId, "history" | "database">,
  string[]
> = {
  "week-detail": [...WEEKLY_DETAIL_COLUMNS],
  "weekly-summary": [...WEEKLY_KPI_COLUMNS],
  "paid-comm": ["Month", "Affiliate Username", "Status", "Adjustment", "Final Comm"],
  "bad-aff": WEEKLY_DETAIL_COLUMNS.filter((column) => column !== "Status"),
  "adjustment-notes": [...WEEKLY_DETAIL_COLUMNS],
  "system-comm-raw": [
    "Month",
    "Start Date",
    "Affiliate Username",
    "Structure Name",
    "Period",
    "Type",
    "Status",
    "Original Amount",
    "Paid Amount",
    "Created Time",
    "Update Time",
    "Updated By",
  ],
  // Core Aff Raw columns. Per-game Bet Count / Total Stake / Total Turnover /
  // Total Profit&Loss headers are appended from the uploaded file.
  "aff-raw-upload": [
    "Month",
    "Affiliate Code",
    "Upline Affiliate Username",
    "Affiliate Username",
    "Sign Up Country",
    "Currency",
    "Approved Time",
    "Registered Users",
    "Number of First Deposit",
    "First Deposit",
    "Active Players",
    "Total Deposit",
    "Total Deposit Payment Fee",
    "Total Withdrawal",
    "Total Withdrawal Payment Fee",
    "Total Number of Bets",
    "Total Turnover",
    "Total Profit&Loss",
    "Total Jackpot Cost",
    "Total Bonus",
    "VIP Cash Bonus",
    "Total Referral Commission",
    "Total Revenue Adjustment",
    "Total Deduction",
    "Total Net Profit",
  ],
  // Core Player Raw columns. Per-game metric headers come from the uploaded file.
  "player-raw-upload": [
    "Month",
    "Start",
    "End",
    "Affiliate Code",
    "Upline Affiliate Username",
    "Affiliate Username",
    "Sign Up Country",
    "Currency",
    "Keyword",
    "Username",
    "Registration Time",
    "First Deposit Time",
    "Total Deposit",
    "Total Deposit Payment Fee",
    "Total Withdrawal",
    "Total Withdrawal Payment Fee",
    "Total Number of Bets",
    "Total Turnover",
    "Total Profit & Loss",
    "Total Jackpot Cost",
    "Total Bonus",
    "Total VIP Cash Bonus",
    "Total Referral Commission",
    "Total Revenue Adjustment",
  ],
  "business-raw": [
    "Date",
    "SU",
    "FTD",
    "Conversion %",
    "Active Player",
    "DEP Count",
    "DEP Amt",
    "Aff Adjustment",
    "WTD Count",
    "WTD Amt",
    "Net Deposit",
    "Hold Ratio",
    "Turnover",
    "Gross Revenue",
    "Bonus",
    "RAF Bonus",
    "VP Points > Cash",
    "Adjustment",
    "Net Revenue",
  ],
  "promo-ended": ["Transfer Week", "Affiliate Username", "Promo Ended"],
  "aff-su": [
    "Month",
    "SU Date",
    "#",
    "Affiliate Username",
    "Affiliate Code",
    "First Name",
    "Last Name",
    "Email",
    "Internal",
    "Status",
    "Registration Time",
    "Approved Time",
    "Mobile Number",
    "Other Contact Details",
    "Commission Structure",
  ],
};

/** Excel-style data bars for Business Raw (matches guideline conditional formatting). */
export type DataBarConfig = {
  mode: "positive" | "diverging";
  /** Visual preset matching the Excel screenshot. */
  variant: "blue" | "red" | "orange" | "blue-gradient" | "green-red";
  /** Optional text coloring. */
  tintText?: "always-red" | "signed";
};

export const BUSINESS_RAW_DATA_BARS: Record<string, DataBarConfig> = {
  FTD: { mode: "positive", variant: "blue" },
  "Active Player": { mode: "positive", variant: "red", tintText: "always-red" },
  "DEP Amt": { mode: "positive", variant: "orange" },
  Turnover: { mode: "positive", variant: "blue-gradient" },
  "Net Revenue": { mode: "diverging", variant: "green-red" },
};

export function emptyRows(count = 18): string[][] {
  return Array.from({ length: count }, () => []);
}
