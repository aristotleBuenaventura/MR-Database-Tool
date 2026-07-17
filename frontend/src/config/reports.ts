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
  | "system-comm-raw"
  | "aff-raw-upload"
  | "player-raw-upload"
  | "business-raw"
  | "aff-su"
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
  { id: "b3-bdt", label: "B3 BDT", period: "weekly" },
  { id: "b4-bdt", label: "B4 BDT", period: "weekly" },
  { id: "b5-bdt", label: "B5 BDT", period: "weekly" },
  { id: "k1-bdt", label: "K1 BDT", period: "weekly" },
  { id: "tk-bdt", label: "TK BDT", period: "weekly" },
  { id: "jw-bdt", label: "JW BDT", period: "weekly" },
];

export const MONTHLY_MARKETS: Market[] = [
  { id: "m1-bdt-monthly", label: "M1 BDT", period: "monthly" },
];

/** Order matches guideline / sample workbook: week detail first, then sources, then Weekly Summary. */
export const REPORT_TABS: ReportTab[] = [
  { id: "week-detail", label: "Week Detail" },
  { id: "aff-raw-upload", label: "Aff Raw Upload" },
  { id: "player-raw-upload", label: "Player Raw Upload" },
  { id: "system-comm-raw", label: "System Comm Raw" },
  { id: "weekly-summary", label: "Weekly Summary" },
  { id: "paid-comm", label: "Paid Comm" },
  { id: "bad-aff", label: "Bad Aff" },
  { id: "aff-su", label: "AFF SU" },
  { id: "business-raw", label: "Business Raw" },
  { id: "history", label: "History" },
  { id: "database", label: "Database" },
];

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
  "AP Qualified (TO>1000)",
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
]);

/** Editable Status on Week Detail: Paid / Unpaid / Reject (Reject deletes the row). */
export const WEEKLY_STATUS_TOGGLE_COLUMNS = new Set(["Status"]);

/** Guideline WEEKLY SUMMARY TAB (KPI aggregates). */
export const WEEKLY_KPI_COLUMNS = [
  "Month",
  "New Sign Up",
  "Total Aff",
  "Active Affiliates >5 Player",
  "Active Affiliates <5 Players",
  "Dormant Aff",
  "Active Players",
  "Deposit",
  "Total Turnover",
  "Sports",
  "Live Casino",
  "Slots",
  "Table",
  "Others",
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

export const TAB_COLUMNS: Record<
  Exclude<ReportTabId, "history" | "database">,
  string[]
> = {
  "week-detail": [...WEEKLY_DETAIL_COLUMNS],
  "weekly-summary": [...WEEKLY_KPI_COLUMNS],
  "paid-comm": ["Month", "Affiliate Username", "Status", "Adjustment", "Final Comm"],
  "bad-aff": WEEKLY_DETAIL_COLUMNS.filter((column) => column !== "Status"),
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
    "Slots Bet Count",
    "Slots Total Stake",
    "Slots Total Turnover",
    "Slots Total Profit&Loss",
    "Live Casino Bet Count",
    "Live Casino Total Stake",
    "Live Casino Total Turnover",
    "Live Casino Total Profit&Loss",
    "Sports Bet Count",
    "Sports Total Stake",
    "Sports Total Turnover",
    "Sports Total Profit&Loss",
    "Fishing Bet Count",
    "Fishing Total Stake",
    "Fishing Total Turnover",
    "Fishing Total Profit&Loss",
    "E-sports Bet Count",
    "E-sports Total Stake",
    "E-sports Total Turnover",
    "E-sports Total Profit & Loss",
    "Lottery Bet Count",
    "Lottery Total Stake",
    "Lottery Total Turnover",
    "Lottery Total Profit & Loss",
    "Table Bet Count",
    "Table Total Stake",
    "Table Total Turnover",
    "Table Total Profit & Loss",
    "Arcade Bet Count",
    "Arcade Total Stake",
    "Arcade Total Turnover",
    "Arcade Total Profit & Loss",
    "Crash Bet Count",
    "Crash Total Stake",
    "Crash Total Turnover",
    "Crash Total Profit & Loss",
  ],
  "player-raw-upload": [
    "Month",
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
    "Slots Bet Count",
    "Slots Total Stake",
    "Slots Total Turnover",
    "Slots Total Profit & Loss",
    "Live Casino Bet Count",
    "Live Casino Total Stake",
    "Live Casino Total Turnover",
    "Live Casino Total Profit & Loss",
    "Sports Bet Count",
    "Sports Total Stake",
    "Sports Total Turnover",
    "Sports Total Profit & Loss",
    "Fishing Bet Count",
    "Fishing Total Stake",
    "Fishing Total Turnover",
    "Fishing Total Profit & Loss",
    "E-sports Bet Count",
    "E-sports Total Stake",
    "E-sports Total Turnover",
    "E-sports Total Profit & Loss",
    "Lottery Bet Count",
    "Lottery Total Stake",
    "Lottery Total Turnover",
    "Lottery Total Profit & Loss",
    "Table Bet Count",
    "Table Total Stake",
    "Table Total Turnover",
    "Table Total Profit & Loss",
    "Arcade Bet Count",
    "Arcade Total Stake",
    "Arcade Total Turnover",
    "Arcade Total Profit & Loss",
    "Crash Bet Count",
    "Crash Total Stake",
    "Crash Total Turnover",
    "Crash Total Profit & Loss",
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
