export type ReportPeriod = "weekly" | "monthly";

export type Market = {
  id: string;
  label: string;
  period: ReportPeriod;
};

export type ReportTabId =
  | "weekly-summary"
  | "paid-comm"
  | "system-comm-raw"
  | "aff-raw-upload"
  | "player-raw-upload"
  | "business-raw"
  | "aff-su"
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

export const REPORT_TABS: ReportTab[] = [
  { id: "weekly-summary", label: "Weekly Summary" },
  { id: "paid-comm", label: "Paid Comm" },
  { id: "system-comm-raw", label: "System Comm Raw" },
  { id: "aff-raw-upload", label: "Aff Raw Upload" },
  { id: "player-raw-upload", label: "Player Raw Upload" },
  { id: "business-raw", label: "Business Raw" },
  { id: "aff-su", label: "AFF SU" },
  { id: "database", label: "DATABASE" },
];

/** Placeholder week options — later driven by uploaded data. */
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

export const TAB_COLUMNS: Record<Exclude<ReportTabId, "database">, string[]> = {
  "weekly-summary": [
    "SU MONTH",
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
    "Last Week NCF",
    "Next Week NCF",
  ],
  "paid-comm": ["Month", "Affiliate Username", "Status", "Adjustment", "Final Comm"],
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
    "Total Turnover",
    "Total Profit&Loss",
    "Total Bonus",
    "VIP Cash Bonus",
    "Total Net Profit",
  ],
  "player-raw-upload": [
    "Month",
    "Start",
    "End",
    "FTD",
    "FTD Date",
    "Affiliate Code",
    "Upline Affiliate Username",
    "Affiliate Username",
    "Username",
    "Total Deposit",
    "Total Turnover",
    "Total Profit & Loss",
    "Total Bonus",
  ],
  "business-raw": [
    "Date",
    "SU",
    "FTD",
    "Conversion %",
    "Active Player",
    "DEP Count",
    "DEP Amt",
    "WTD Count",
    "WTD Amt",
    "Net Deposit",
    "Turnover",
    "Gross Revenue",
    "Bonus",
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
    "Commission Structure",
  ],
};

export const DATABASE_CATEGORIES = [
  { id: "aff-raw", label: "AFF RAW FILES" },
  { id: "player-raw", label: "PLAYER RAW FILES" },
  { id: "system-comm", label: "SYSTEM COMM" },
  { id: "paid-comm", label: "PAID COMM" },
  { id: "aff-su", label: "AFF SU" },
] as const;

export function emptyRows(count = 18): string[][] {
  return Array.from({ length: count }, () => []);
}
