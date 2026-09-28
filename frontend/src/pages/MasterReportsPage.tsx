import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { BrandMark } from "../components/BrandMark";
import {
  REPORT_TABS,
  TAB_COLUMNS,
  WEEKLY_DETAIL_COLUMNS,
  WEEKLY_EDITABLE_COLUMNS,
  WEEKLY_KPI_COLUMNS,
  WEEKLY_MARKETS,
  WEEKLY_STATUS_TOGGLE_COLUMNS,
  WEEKLY_SUMMARY_EDITABLE_COLUMNS,
  BUSINESS_RAW_DATA_BARS,
  badAffColumnsForMarket,
  weekDetailColumnsForMarket,
  type Market,
  type ReportTabId,
} from "../config/reports";
import { AffiliateFilter } from "../components/reports/AffiliateFilter";
import {
  DataGrid,
  pageSizeForRowView,
  type RowViewMode,
} from "../components/reports/DataGrid";
import { ExportButton } from "../components/reports/ExportButton";
import { HistoryPanel } from "../components/reports/HistoryPanel";
import { DatabasePanel } from "../components/reports/DatabasePanel";
import { BackupPanel } from "../components/reports/BackupPanel";
import { ReportsSidebar } from "../components/reports/ReportsSidebar";
import { ReportsTopBar } from "../components/reports/ReportsTopBar";
import { UploadPanel } from "../components/reports/UploadPanel";
import { WeeklyImportModal } from "../components/reports/WeeklyImportModal";
import { TwoFactorSetup } from "../components/TwoFactorSetup";
import { parseWorkbookFile, remapRowsToColumns, type ParsedWorkbook } from "../lib/excel";
import {
  defaultCommissionSettings,
  resolveCommissionProfile,
  sanitizeCommissionSettings,
  type CommissionProfile,
  type CommissionSettings,
} from "../lib/commissionSettings";
import { exportTableCsv } from "../lib/exportCsv";
import { resolveWeekDateRangeLabel } from "../lib/weekDateRange";
import {
  cacheKey,
  clearReportCache,
  getCachedReport,
  loadCached,
  setCachedReport,
  type CachedTabData,
} from "../lib/reportCache";
import {
  applyWeeklySummaryAffCellEdit,
  computeNewSignUpByWeek,
  resolvePrevTotalAffForWeek,
  computeWeeklyDetail,
  computeWeeklyKpi,
  derivePaidComm,
  applyNegativeCarryOverFromPrev,
  recalculateWeeklySummaryOthers,
  recalculateWeeklySummaryNet,
  sumAffRawWeeklySummaryNet,
  readBaseWeeklySummarySeed,
  BASE_WEEK_DETAIL_CATEGORY,
  BASE_WEEK_DETAIL_LOCATION,
  BASE_WEEK_SUMMARY_LOCATION,
  finalizeBaseWeekDetail,
  isBaseWeekDetailCategory,
  isBaseWeekDetailLocation,
  isBaseWeeklySummaryCategory,
  isBaseWeeklySummaryLocation,
  recalculateWeeklyDetailRow,
  alignWeekDetailRows,
  weekDetailCarryChanged,
} from "../lib/weeklyCompute";
import {
  importAllSourceSheets,
  importBaseWeekDetailSheet,
  importBaseWeeklySummarySheet,
  isRawUploadTabId,
  nextWeekCode,
  pickPrimaryWeekFromImported,
  previousWeekCode,
  sortRowsByWeek,
  splitRowsByWeek,
  type RawUploadTabId,
} from "../lib/weeklyImport";

const FILTER_PRESETS: Partial<
  Record<ReportTabId, { id: string; label: string; type?: "text" | "date" }[]>
> = {
  "week-detail": [{ id: "affiliateUsername", label: "Affiliate Username" }],
  "paid-comm": [{ id: "affiliateUsername", label: "Affiliate Username" }],
  "adjustment-notes": [{ id: "affiliateUsername", label: "Affiliate Username" }],
  "system-comm-raw": [{ id: "affiliateUsername", label: "Affiliate Username" }],
  "aff-raw-upload": [{ id: "affiliateUsername", label: "Affiliate Username" }],
  "player-raw-upload": [{ id: "affiliateUsername", label: "Affiliate Username" }],
};

const SOURCE_TABS: ReportTabId[] = [
  "aff-raw-upload",
  "player-raw-upload",
  "system-comm-raw",
  "aff-su",
  "business-raw",
  "paid-comm",
];

const RAW_UPLOAD_TABS: RawUploadTabId[] = [
  "aff-raw-upload",
  "player-raw-upload",
  "system-comm-raw",
  "aff-su",
  "business-raw",
];

const RAW_UPLOAD_TITLES: Record<RawUploadTabId, string> = {
  "aff-raw-upload": "AFF RAW UPLOAD",
  "player-raw-upload": "PLAYER RAW UPLOAD",
  "system-comm-raw": "SYSTEM COMM RAW UPLOAD",
  "aff-su": "AFF SU UPLOAD",
  "business-raw": "BUSINESS RAW UPLOAD",
};

const DEFAULT_ROW_VIEW_MODE: RowViewMode = "scroll";
const ROW_VIEW_OPTIONS: { value: RowViewMode; label: string }[] = [
  { value: "scroll", label: "With scroll" },
  { value: "20", label: "20" },
  { value: "50", label: "50" },
  { value: "100", label: "100" },
];

function columnsForTab(
  tabId: ReportTabId,
  marketId?: string,
  totalProfitLoss?: CommissionProfile["totalProfitLoss"] | null,
): string[] {
  if (tabId === "history" || tabId === "database") return [];
  if (tabId === "week-detail" || tabId === "adjustment-notes") {
    return weekDetailColumnsForMarket(marketId, totalProfitLoss);
  }
  if (tabId === "bad-aff") return badAffColumnsForMarket(marketId, totalProfitLoss);
  return TAB_COLUMNS[tabId];
}

const VIEW_STORAGE_KEY = "mr-reports-view";

type PersistedReportsView = {
  marketId?: string;
  tabId?: string;
  week?: string;
  collapsed?: boolean;
};

function readPersistedReportsView(): PersistedReportsView {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(VIEW_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as PersistedReportsView;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writePersistedReportsView(view: PersistedReportsView): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify(view));
  } catch {
    // ignore quota / private mode failures
  }
}

function initialMarket(): Market {
  const saved = readPersistedReportsView().marketId;
  return (
    WEEKLY_MARKETS.find((item) => item.id === saved) ??
    WEEKLY_MARKETS.find((item) => item.id === "tk-bdt") ??
    WEEKLY_MARKETS[0]!
  );
}

function initialTab(): ReportTabId {
  const saved = readPersistedReportsView().tabId;
  if (saved && REPORT_TABS.some((tab) => tab.id === saved)) {
    return saved as ReportTabId;
  }
  return "week-detail";
}

function initialWeek(): string {
  const saved = String(readPersistedReportsView().week ?? "")
    .trim()
    .toUpperCase();
  return /^\d{4}W\d{2}$/.test(saved) ? saved : "";
}

function initialCollapsed(): boolean {
  return Boolean(readPersistedReportsView().collapsed);
}

function filterRows(
  rows: string[][],
  columns: string[],
  filters: Record<string, string | string[]>,
  filterFields: { id: string; label: string; type?: "text" | "date" }[],
): string[][] {
  let result = rows;

  for (const field of filterFields) {
    if (
      field.id === "affiliateUsername" ||
      field.label.toLowerCase().includes("affiliate username")
    ) {
      continue;
    }

    const raw = filters[field.id];
    if (typeof raw !== "string") continue;
    const value = raw.trim().toLowerCase();
    if (!value) continue;

    const columnIndex = columns.findIndex(
      (column) => column.toLowerCase() === field.label.toLowerCase(),
    );
    if (columnIndex < 0) continue;

    result = result.filter((row) =>
      String(row[columnIndex] ?? "")
        .toLowerCase()
        .includes(value),
    );
  }

  const usernameField = filterFields.find(
    (field) =>
      field.id === "affiliateUsername" ||
      field.label.toLowerCase().includes("affiliate username"),
  );
  const selectedUsernames = usernameField
    ? filters[usernameField.id]
    : undefined;

  if (Array.isArray(selectedUsernames) && selectedUsernames.length > 0) {
    const columnIndex = columns.findIndex(
      (column) => column.toLowerCase() === "affiliate username",
    );
    if (columnIndex < 0) return result;

    const ordered: string[][] = [];
    for (const name of selectedUsernames) {
      const key = name.trim().toLowerCase();
      if (!key) continue;
      for (const row of result) {
        if (String(row[columnIndex] ?? "").trim().toLowerCase() === key) {
          ordered.push(row);
        }
      }
    }
    return ordered;
  }

  return result;
}

function uniqueUsernames(rows: string[][], columns: string[]): string[] {
  const columnIndex = columns.findIndex(
    (column) => column.toLowerCase() === "affiliate username",
  );
  if (columnIndex < 0) return [];

  const seen = new Set<string>();
  const names: string[] = [];
  for (const row of rows) {
    const name = String(row[columnIndex] ?? "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

/** Load week-detail with fallback to older weekly-summary storage (pre-split). */
async function loadWeekDetailRows(
  marketId: string,
  week: string,
  options?: { normalize?: boolean; profile?: CommissionProfile | null },
) {
  // Prefer an uploaded base Week Detail — never formula-normalize it.
  const base = await api.getReport({
    marketId,
    week,
    tabId: "week-detail",
    category: BASE_WEEK_DETAIL_CATEGORY,
  });
  if (base.dataset?.rows?.length) {
    return {
      rows: alignWeekDetailRows(
        base.dataset.rows,
        marketId,
        base.dataset.columns,
        options?.profile,
      ),
      fileName: base.dataset.fileName ?? "",
      location: BASE_WEEK_DETAIL_LOCATION,
      category: BASE_WEEK_DETAIL_CATEGORY,
    };
  }

  const primary = await api.getReport({ marketId, week, tabId: "week-detail" });
  if (primary.dataset?.rows?.length) {
    const location = primary.dataset.location ?? "";
    const category = primary.dataset.category ?? "";
    const isBase =
      isBaseWeekDetailLocation(location) || isBaseWeekDetailCategory(category);
    // Base uploads stay as-is. Computed weeks re-run formulas so FINAL NET
    // keeps 2 decimals and Calculated Commission uses that same value.
    const shouldRecalc = !isBase && options?.normalize !== false;
    const aligned = alignWeekDetailRows(
      primary.dataset.rows,
      marketId,
      primary.dataset.columns,
      options?.profile,
    );
    const rows = shouldRecalc
      ? aligned.map((row) => recalculateWeeklyDetailRow(row, marketId, options?.profile))
      : aligned;
    return {
      rows,
      fileName: primary.dataset.fileName ?? "",
      location: isBase ? BASE_WEEK_DETAIL_LOCATION : location,
      category,
    };
  }

  const legacy = await api.getReport({ marketId, week, tabId: "weekly-summary" });
  const cols = (legacy.dataset?.columns ?? []).map((c) => c.toLowerCase());
  const isWeekDetailShape =
    cols.includes("affiliate username") &&
    (cols.includes("final net") || cols.includes("final commission"));

  if (isWeekDetailShape && (legacy.dataset?.rows?.length ?? 0) > 0) {
    return {
      rows: alignWeekDetailRows(
        legacy.dataset!.rows,
        marketId,
        legacy.dataset?.columns,
        options?.profile,
      ),
      fileName: legacy.dataset?.fileName ?? "",
      location: legacy.dataset?.location ?? "",
      category: legacy.dataset?.category ?? "",
    };
  }

  return {
    rows: [] as string[][],
    fileName: "",
    location: "",
    category: "",
  };
}

function isKpiDataset(columns: string[], rows: string[][]): boolean {
  const cols = columns.map((c) => c.toLowerCase());
  if (
    cols.includes("new sign up") ||
    cols.includes("active affiliates >5 player") ||
    cols.includes("commission / net")
  ) {
    return true;
  }
  // Legacy week-detail was stored under weekly-summary — skip those.
  if (
    cols.includes("affiliate username") &&
    (cols.includes("final net") || cols.includes("final commission"))
  ) {
    return false;
  }
  // category=kpi rows often have KPI width without stored column labels matching.
  return rows.some((row) => /^\d{4}W\d{2}$/i.test(String(row[0] ?? "").trim()));
}

function sortWeeklySummaryRows(rows: string[][]): string[][] {
  return [...rows].sort((a, b) =>
    String(a[0] ?? "")
      .toUpperCase()
      .localeCompare(String(b[0] ?? "").toUpperCase()),
  );
}

/** Upsert KPI row(s) into an all-weeks Weekly Summary table by Month/week code. */
function upsertWeeklySummaryRows(
  existing: string[][],
  incoming: string[][],
): string[][] {
  const byWeek = new Map<string, string[]>();
  for (const row of existing) {
    const key = String(row[0] ?? "")
      .trim()
      .toUpperCase();
    if (key) byWeek.set(key, row);
  }
  for (const row of incoming) {
    const key = String(row[0] ?? "")
      .trim()
      .toUpperCase();
    if (key) byWeek.set(key, row);
  }
  return sortWeeklySummaryRows([...byWeek.values()]);
}

/** Load Weekly Summary for ALL weeks (not filtered by selected week). */
async function loadWeeklySummaryAllWeeks(marketId: string) {
  const [result, affRawResult] = await Promise.all([
    api.getReportsByTab({
      marketId,
      tabId: "weekly-summary",
    }),
    api.getReportsByTab({
      marketId,
      tabId: "aff-raw-upload",
    }),
  ]);

  const byWeek = new Map<string, string[]>();
  const layoutsByWeek = new Map<string, string[]>();
  const baseWeeks = new Set<string>();
  let fileName = "";

  for (const dataset of result.datasets) {
    if (!isKpiDataset(dataset.columns, dataset.rows)) continue;
    if (!fileName && dataset.fileName) fileName = dataset.fileName;
    const datasetColumns =
      dataset.columns && dataset.columns.length > 0
        ? dataset.columns
        : [...WEEKLY_KPI_COLUMNS];
    const isBase =
      isBaseWeeklySummaryCategory(dataset.category) ||
      isBaseWeeklySummaryLocation(dataset.location);

    for (const row of dataset.rows) {
      const month = String(row[0] ?? "")
        .trim()
        .toUpperCase();
      const weekKey = month || dataset.week.toUpperCase();
      if (!weekKey) continue;

      // Ensure Month column is populated for sorting/display.
      const normalized =
        month && /^\d{4}W\d{2}$/i.test(month)
          ? row
          : [dataset.week, ...row.slice(1)];

      const hasBase = baseWeeks.has(weekKey);
      if (isBase) {
        byWeek.set(weekKey, normalized);
        layoutsByWeek.set(weekKey, datasetColumns);
        baseWeeks.add(weekKey);
      } else if (!hasBase) {
        byWeek.set(weekKey, normalized);
        layoutsByWeek.set(weekKey, datasetColumns);
      }
    }
  }

  // Net = Aff Raw Total Profit&Loss − Deduction − VIP Cash Bonus − Bonus
  const netByWeek = new Map<string, number>();
  for (const dataset of affRawResult.datasets) {
    if (!dataset.rows?.length) continue;
    const weekKey = String(dataset.week ?? "")
      .trim()
      .toUpperCase();
    if (!/^\d{4}W\d{2}$/i.test(weekKey)) continue;
    const cols = dataset.columns?.length
      ? dataset.columns
      : TAB_COLUMNS["aff-raw-upload"];
    netByWeek.set(weekKey, sumAffRawWeeklySummaryNet(dataset.rows, cols));
  }

  // Always display the fixed Weekly Summary layout (Sports / Live Casino /
  // Slots / Table / Others). Remap older dynamic-game KPI rows if needed,
  // then recompute Others / Net so formulas stay correct.
  const columns = [...WEEKLY_KPI_COLUMNS];
  if (byWeek.size > 0) {
    for (const [weekKey, row] of [...byWeek.entries()]) {
      if (baseWeeks.has(weekKey)) continue;
      const from = layoutsByWeek.get(weekKey) ?? columns;
      const remapped = remapRowsToColumns([row], from, columns)[0] ?? row;
      const withOthers = recalculateWeeklySummaryOthers(remapped, columns);
      const net = netByWeek.get(weekKey.toUpperCase());
      byWeek.set(
        weekKey,
        net == null
          ? withOthers
          : recalculateWeeklySummaryNet(withOthers, net, columns),
      );
    }
  }

  // Refresh New Sign Up + Total Aff from Aff SU. Base-file weeks keep uploaded
  // Total Aff; later weeks carry forward from the latest base week.
  try {
    const affSu = await loadAffSuAllWeeks(marketId);
    const newSignUpByWeek = computeNewSignUpByWeek(affSu.rows);
    if (newSignUpByWeek.size > 0) {
      const newSignUpIndex = columns.indexOf("New Sign Up");
      const totalAffIndex = columns.indexOf("Total Aff");
      const activeGe5Index = columns.indexOf(
        "Active Affiliates >5 Player",
      );
      const activeLt5Index = columns.indexOf(
        "Active Affiliates <5 Players",
      );
      const dormantIndex = columns.indexOf("Dormant Aff");

      const baseRowsByWeek = new Map<string, string[]>();
      for (const weekKey of baseWeeks) {
        const row = byWeek.get(weekKey);
        if (row) baseRowsByWeek.set(weekKey, row);
      }
      const { seedWeek, seedTotalAff } = readBaseWeeklySummarySeed(baseRowsByWeek);

      const toNum = (value: unknown) =>
        Number(String(value ?? "").replace(/,/g, "").trim()) || 0;

      const sortedWeekKeys = [...byWeek.keys()].sort((a, b) => a.localeCompare(b));

      for (const weekKey of sortedWeekKeys) {
        if (baseWeeks.has(weekKey)) continue;
        const wk = weekKey.toUpperCase();
        const count = newSignUpByWeek.get(wk);
        if (count == null) continue;
        const row = byWeek.get(weekKey);
        if (!row) continue;
        const updated = [...row];
        if (newSignUpIndex >= 0) updated[newSignUpIndex] = String(count);
        const prevTotalAff = resolvePrevTotalAffForWeek(
          wk,
          byWeek,
          seedWeek,
          seedTotalAff,
          columns,
        );
        const totalAff = prevTotalAff != null ? prevTotalAff + count : count;
        if (totalAffIndex >= 0) updated[totalAffIndex] = String(totalAff);
        if (dormantIndex >= 0 && activeGe5Index >= 0 && activeLt5Index >= 0) {
          updated[dormantIndex] = String(
            totalAff -
              toNum(updated[activeGe5Index]) -
              toNum(updated[activeLt5Index]),
          );
        }
        byWeek.set(weekKey, updated);
      }
    }
  } catch {
    // Non-fatal: fall back to stored New Sign Up / Total Aff values.
  }

  return {
    rows: sortWeeklySummaryRows([...byWeek.values()]),
    fileName,
    location: "",
    columns,
  };
}

/** Load Business Raw for ALL weeks (not filtered by selected week). */
async function loadBusinessRawAllWeeks(marketId: string) {
  const result = await api.getReportsByTab({
    marketId,
    tabId: "business-raw",
  });

  const byWeek = new Map<string, string[]>();
  let fileName = "";

  for (const dataset of result.datasets) {
    if (!fileName && dataset.fileName) fileName = dataset.fileName;

    for (const row of dataset.rows) {
      const date = String(row[0] ?? "")
        .trim()
        .toUpperCase();
      const weekKey = /^\d{4}W\d{2}$/i.test(date)
        ? date
        : String(dataset.week ?? "")
            .trim()
            .toUpperCase();
      if (!weekKey) continue;

      const normalized =
        date && /^\d{4}W\d{2}$/i.test(date) ? row : [weekKey, ...row.slice(1)];
      byWeek.set(weekKey, normalized);
    }
  }

  return {
    rows: sortRowsByWeek(TAB_COLUMNS["business-raw"], [...byWeek.values()]),
    fileName,
    location: "",
  };
}

/** Load Aff SU across ALL weeks (shared signup list; not filtered by selected week). */
async function loadAffSuAllWeeks(marketId: string) {
  const result = await api.getReportsByTab({
    marketId,
    tabId: "aff-su",
  });

  const seen = new Set<string>();
  const rows: string[][] = [];
  let fileName = "";

  const datasets = [...result.datasets].sort((a, b) =>
    String(a.week ?? "")
      .toUpperCase()
      .localeCompare(String(b.week ?? "").toUpperCase()),
  );

  for (const dataset of datasets) {
    if (!fileName && dataset.fileName) fileName = dataset.fileName;
    for (const row of dataset.rows ?? []) {
      const key = row.map((cell) => String(cell ?? "").trim()).join("\u0001");
      if (!key || seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
    }
  }

  return {
    rows: sortRowsByWeek(TAB_COLUMNS["aff-su"], rows),
    fileName,
    location: "",
  };
}

const ALL_WEEKS_CACHE_WEEK = "*";
const WEEKLY_SUMMARY_CACHE_WEEK = ALL_WEEKS_CACHE_WEEK;

function isAllWeeksTab(tabId: ReportTabId): boolean {
  return (
    tabId === "weekly-summary" ||
    tabId === "business-raw" ||
    tabId === "aff-su"
  );
}

/** Index of the Status column in Week Detail rows (excluded from Bad Aff). */
const WEEK_DETAIL_STATUS_INDEX = TAB_COLUMNS["week-detail"].indexOf("Status");
const WEEK_DETAIL_WEEK_INDEX = TAB_COLUMNS["week-detail"].indexOf("Week");
const WEEK_DETAIL_USERNAME_INDEX =
  TAB_COLUMNS["week-detail"].indexOf("Affiliate Username");
const WEEK_DETAIL_ADJUSTMENT_INDEX =
  TAB_COLUMNS["week-detail"].indexOf("Adjustment");

/** Convert a full Week Detail row into a Bad Aff row (drops the Status cell). */
function toBadAffRow(weekDetailRow: string[]): string[] {
  if (WEEK_DETAIL_STATUS_INDEX < 0) return [...weekDetailRow];
  return weekDetailRow.filter((_, index) => index !== WEEK_DETAIL_STATUS_INDEX);
}

/**
 * Legacy Bad Aff rows were stored with the full Week Detail shape (incl. Status).
 * Normalize those older rows to the current (status-less) Bad Aff shape.
 */
function normalizeBadAffRow(
  row: string[],
  marketId: string,
  totalProfitLoss?: CommissionProfile["totalProfitLoss"] | null,
): string[] {
  const weekCols = weekDetailColumnsForMarket(marketId, totalProfitLoss);
  const badCols = badAffColumnsForMarket(marketId, totalProfitLoss);
  let base = row;
  if (
    base.length === weekCols.length + 1 ||
    base.length === WEEKLY_DETAIL_COLUMNS.length + 1
  ) {
    base = base.slice(1);
  }
  if (base.length === weekCols.length) return toBadAffRow(base);
  if (base.length === WEEKLY_DETAIL_COLUMNS.length) {
    const aligned =
      remapRowsToColumns([base], [...WEEKLY_DETAIL_COLUMNS], weekCols)[0] ??
      base;
    return toBadAffRow(aligned);
  }
  if (base.length === badCols.length) return base;
  return remapRowsToColumns([base], TAB_COLUMNS["bad-aff"], badCols)[0] ?? base;
}

function weekDetailAffiliateKey(row: string[]): string {
  const weekVal = String(row[WEEK_DETAIL_WEEK_INDEX] ?? "")
    .trim()
    .toUpperCase();
  const userVal = String(row[WEEK_DETAIL_USERNAME_INDEX] ?? "")
    .trim()
    .toLowerCase();
  return `${weekVal}\u0001${userVal}`;
}

function rowHasAdjustment(row: string[]): boolean {
  const raw = String(row[WEEK_DETAIL_ADJUSTMENT_INDEX] ?? "")
    .replace(/,/g, "")
    .trim();
  if (!raw) return false;
  const n = Number(raw);
  return Number.isFinite(n) && n !== 0;
}

export function MasterReportsPage() {
  const navigate = useNavigate();
  const { user, capabilities, logout } = useAuth();
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [market, setMarket] = useState<Market>(initialMarket);
  const [week, setWeek] = useState(initialWeek);
  const [weekOptions, setWeekOptions] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<ReportTabId>(initialTab);
  const [filters, setFilters] = useState<Record<string, string | string[]>>({});
  const [uploadName, setUploadName] = useState("");
  const [tableRows, setTableRows] = useState<string[][]>([]);
  const [tableColumns, setTableColumns] = useState<string[] | null>(null);
  const [pendingWorkbook, setPendingWorkbook] = useState<ParsedWorkbook | null>(null);
  const [pendingUploadTab, setPendingUploadTab] = useState<RawUploadTabId | null>(null);
  const [readingFile, setReadingFile] = useState(false);
  const [baseUploading, setBaseUploading] = useState(false);
  const [baseSummaryUploading, setBaseSummaryUploading] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [savingData, setSavingData] = useState(false);
  const [saveProgress, setSaveProgress] = useState<string | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  useEffect(() => {
    if (!importMessage) return;
    const timer = window.setTimeout(() => setImportMessage(null), 5000);
    return () => window.clearTimeout(timer);
  }, [importMessage]);
  const [selectedVisibleIndices, setSelectedVisibleIndices] = useState<Set<number>>(
    () => new Set(),
  );
  const [bulkRejectOpen, setBulkRejectOpen] = useState(false);
  const [weekDetailUndo, setWeekDetailUndo] = useState<{
    marketId: string;
    week: string;
    rows: string[][];
    badAffRows: string[][] | null;
    adjustmentNotesRows: string[][] | null;
  } | null>(null);
  const [undoingWeekDetail, setUndoingWeekDetail] = useState(false);
  const [rowViewByTab, setRowViewByTab] = useState<
    Partial<Record<ReportTabId, RowViewMode>>
  >({});
  const [gridPage, setGridPage] = useState(1);
  const rowViewMode = rowViewByTab[activeTab] ?? DEFAULT_ROW_VIEW_MODE;
  const [playerRawRangeTick, setPlayerRawRangeTick] = useState(0);
  const requestIdRef = useRef(0);
  const [commissionSettings, setCommissionSettings] = useState<CommissionSettings | null>(
    null,
  );
  const commissionSettingsRef = useRef<CommissionSettings | null>(null);
  commissionSettingsRef.current = commissionSettings;

  function profileForWeek(weekCode: string): CommissionProfile {
    return resolveCommissionProfile(
      market.id,
      weekCode,
      commissionSettingsRef.current,
    );
  }

  useEffect(() => {
    let cancelled = false;
    setCommissionSettings(null);
    api
      .getCommissionSettings(market.id)
      .then((result) => {
        if (cancelled) return;
        setCommissionSettings(
          result.settings
            ? sanitizeCommissionSettings(result.settings, market.id)
            : defaultCommissionSettings(market.id),
        );
      })
      .catch((error) => {
        console.error(error);
        if (!cancelled) setCommissionSettings(defaultCommissionSettings(market.id));
      });
    return () => {
      cancelled = true;
    };
  }, [market.id]);

  const canImportExport = Boolean(capabilities?.canImportExport);
  const tabMeta = REPORT_TABS.find((tab) => tab.id === activeTab);
  const activeLabel = tabMeta?.label ?? activeTab;
  const filterFields = FILTER_PRESETS[activeTab] ?? [];
  const isPanelTab = activeTab === "history" || activeTab === "database";
  const columns = isPanelTab
    ? []
    : tableColumns && tableColumns.length > 0
      ? tableColumns
      : columnsForTab(activeTab, market.id, profileForWeek(week).totalProfitLoss);
  const dataWeek = isAllWeeksTab(activeTab) ? ALL_WEEKS_CACHE_WEEK : week;
  const reportLoadKey = isPanelTab
    ? `${activeTab}:${market.id}`
    : cacheKey(market.id, dataWeek, activeTab);

  // Sync hydrate/clear when market/week/tab changes so the first paint never shows
  // the previous tab's rows (that flash looked like "unsorted" Week Detail).
  const [rowsLoadKey, setRowsLoadKey] = useState(reportLoadKey);
  if (rowsLoadKey !== reportLoadKey) {
    setRowsLoadKey(reportLoadKey);
    if (isPanelTab) {
      setTableRows([]);
      setTableColumns(null);
      setUploadName("");
    } else {
      const cached = getCachedReport(reportLoadKey);
      if (cached) {
        // Never re-run formulas on hydrate — that zeroed base / saved values.
        setTableRows(cached.rows);
        setTableColumns(
          cached.columns && cached.columns.length > 0
            ? cached.columns
            : columnsForTab(activeTab, market.id, profileForWeek(week).totalProfitLoss),
        );
        setUploadName(isRawUploadTabId(activeTab) ? cached.fileName : "");
      } else {
        setTableRows([]);
        setTableColumns(
          columnsForTab(activeTab, market.id, profileForWeek(week).totalProfitLoss),
        );
        setUploadName("");
      }
    }
  }

  const visibleRows = useMemo(
    () => filterRows(tableRows, columns, filters, filterFields),
    [tableRows, columns, filters, filterFields],
  );

  const weekDateRangeLabel = useMemo(() => {
    if (activeTab !== "week-detail" || !week) return null;
    const cached = getCachedReport(cacheKey(market.id, week, "player-raw-upload"));
    return resolveWeekDateRangeLabel(
      week,
      cached
        ? {
            columns:
              cached.columns && cached.columns.length > 0
                ? cached.columns
                : TAB_COLUMNS["player-raw-upload"],
            rows: cached.rows,
          }
        : null,
    );
  }, [activeTab, market.id, week, tableRows, playerRawRangeTick]);

  const gridPageSize = pageSizeForRowView(rowViewMode);
  const gridTotalPages = gridPageSize
    ? Math.max(1, Math.ceil(visibleRows.length / gridPageSize))
    : 1;
  const safeGridPage = Math.min(Math.max(1, gridPage), gridTotalPages);
  const gridRangeStart =
    visibleRows.length === 0 || !gridPageSize
      ? visibleRows.length === 0
        ? 0
        : 1
      : (safeGridPage - 1) * gridPageSize + 1;
  const gridRangeEnd = !gridPageSize
    ? visibleRows.length
    : Math.min(safeGridPage * gridPageSize, visibleRows.length);

  const sectionTotals = useMemo(() => {
    if (activeTab !== "week-detail" && activeTab !== "paid-comm") return null;

    const sumColumn = (columnName: string) => {
      const index = columns.indexOf(columnName);
      if (index < 0) return null;
      return visibleRows.reduce((sum, row) => {
        const value = Number(String(row[index] ?? "").replace(/,/g, ""));
        return sum + (Number.isFinite(value) ? value : 0);
      }, 0);
    };

    if (activeTab === "paid-comm") {
      const commission = sumColumn("Final Comm");
      return commission == null ? null : { commission };
    }

    const commission = sumColumn("Final Commission");
    if (commission == null) return null;

    return {
      commission,
      difference: sumColumn("Difference"),
      systemCommission: sumColumn("System Commission"),
      calculatedCommission: sumColumn("Calculated Commission"),
    };
  }, [activeTab, columns, visibleRows]);

  const usernameOptions = useMemo(
    () => uniqueUsernames(tableRows, columns),
    [tableRows, columns],
  );

  const bulkRejectUsernames = useMemo(() => {
    if (activeTab !== "week-detail" || selectedVisibleIndices.size === 0) return [];
    const usernameCol = columns.findIndex(
      (column) => column.toLowerCase() === "affiliate username",
    );
    const names: string[] = [];
    for (const index of [...selectedVisibleIndices].sort((a, b) => a - b)) {
      const row = visibleRows[index];
      const name =
        usernameCol >= 0
          ? String(row?.[usernameCol] ?? "").trim()
          : "";
      names.push(name || `(row ${index + 1})`);
    }
    return names;
  }, [activeTab, selectedVisibleIndices, visibleRows, columns]);

  useEffect(() => {
    clearReportCache();
  }, []);

  useEffect(() => {
    writePersistedReportsView({
      marketId: market.id,
      tabId: activeTab,
      week,
      collapsed,
    });
  }, [market.id, activeTab, week, collapsed]);

  useEffect(() => {
    clearReportCache();
    setTableRows([]);
    setUploadName("");
    setWeekDetailUndo(null);
    setImportMessage(null);
  }, [market.id]);

  useEffect(() => {
    let cancelled = false;

    async function loadWeeks() {
      try {
        const result = await api.getWeeks({ marketId: market.id });
        if (cancelled) return;
        const weeks = [...new Set(result.weeks.map((w) => w.toUpperCase()))].sort(
          (a, b) => b.localeCompare(a),
        );
        setWeekOptions(weeks);
        setWeek((current) => {
          if (current && weeks.includes(current.toUpperCase())) {
            return current.toUpperCase();
          }
          return weeks[0] ?? "";
        });
      } catch (error) {
        console.error(error);
        if (cancelled) return;
        setWeekOptions([]);
        setWeek("");
      }
    }

    void loadWeeks();
    return () => {
      cancelled = true;
    };
  }, [market.id]);

  /**
   * Persist week detail (+ paid) and push Next Week NCF into later weeks
   * until negatives are cleared or no further week detail exists.
   */
  async function cascadeNegativeCarryOver(
    startWeek: string,
    startRows: string[][],
    options?: {
      historyLabel?: string;
      historyAction?: "import" | "edit";
      updateCurrentView?: boolean;
      captureUndo?: boolean;
      /** Walk every later week with saved data (base re-upload). */
      forceCascadeAll?: boolean;
      fileName?: string | null;
    },
  ): Promise<{ weeks: string[] }> {
    const historyLabel =
      options?.historyLabel ??
      `Updated ${startWeek} and cascaded negative carry-over to later weeks`;
    const updateCurrentView = options?.updateCurrentView !== false;
    const forceCascadeAll = options?.forceCascadeAll === true;
    const cascadeFileName = options?.fileName ?? uploadName ?? null;

    type CascadeItem = {
      weekCode: string;
      rows: string[][];
      paidComm: string[][];
    };

    const items: CascadeItem[] = [];
    let weekCode = startWeek;
    let rows = startRows;
    const startLocation =
      getCachedReport(cacheKey(market.id, startWeek, "week-detail"))?.location ??
      "";
    const startIsBase = isBaseWeekDetailLocation(startLocation);
    const startCategory = startIsBase ? BASE_WEEK_DETAIL_CATEGORY : "";

    for (let hop = 0; hop < 80; hop += 1) {
      const paid = derivePaidComm(weekCode, rows);
      items.push({ weekCode, rows, paidComm: paid });
      const location =
        hop === 0 && startIsBase ? BASE_WEEK_DETAIL_LOCATION : "";
      setCachedReport(cacheKey(market.id, weekCode, "week-detail"), {
        rows,
        fileName: cascadeFileName,
        location,
        columns: weekDetailColumnsForMarket(
          market.id,
          profileForWeek(weekCode).totalProfitLoss,
        ),
      });
      setCachedReport(cacheKey(market.id, weekCode, "paid-comm"), {
        rows: paid,
        fileName: cascadeFileName,
        location: "",
      });

      const next = nextWeekCode(weekCode);
      if (!next) break;

      const nextProfile = profileForWeek(next);
      const nextLoaded = await loadWeekDetailRows(market.id, next, {
        normalize: false,
        profile: nextProfile,
      });
      if (nextLoaded.rows.length === 0) break;

      const synced = applyNegativeCarryOverFromPrev(
        nextLoaded.rows,
        rows,
        market.id,
        nextProfile,
      );
      if (
        !forceCascadeAll &&
        !weekDetailCarryChanged(nextLoaded.rows, synced, market.id, nextProfile)
      ) {
        break;
      }

      weekCode = next;
      rows = synced;
    }

    const historyAction = options?.historyAction ?? "edit";
    for (const item of items) {
      const isStartBase =
        item.weekCode === startWeek && startIsBase;
      await api.saveReportsBulk({
        marketId: market.id,
        week: item.weekCode,
        fileName: cascadeFileName,
        historyAction: item.weekCode === startWeek ? historyAction : "edit",
        historyLabel:
          item.weekCode === startWeek
            ? historyLabel
            : forceCascadeAll
              ? `Recalculated ${item.weekCode} from negative carry-over cascade`
              : `Cascaded Last Week NCF carry-over into ${item.weekCode}`,
        items: [
          {
            tabId: "week-detail",
            category: isStartBase ? startCategory : "",
            columns: weekDetailColumnsForMarket(
              market.id,
              profileForWeek(item.weekCode).totalProfitLoss,
            ),
            rows: item.rows,
            sheetName: item.weekCode,
            location: isStartBase ? BASE_WEEK_DETAIL_LOCATION : null,
          },
          {
            tabId: "paid-comm",
            columns: TAB_COLUMNS["paid-comm"],
            rows: item.paidComm,
            sheetName: "derived-from-week-detail",
          },
        ],
      });
    }

    if (updateCurrentView && startWeek === week) {
      if (options?.captureUndo !== false) {
        setWeekDetailUndo({
          marketId: market.id,
          week: startWeek,
          rows: tableRows.map((row) => [...row]),
          badAffRows: null,
          adjustmentNotesRows: null,
        });
      }
      setTableRows(startRows);
      setTableColumns(
        weekDetailColumnsForMarket(market.id, profileForWeek(startWeek).totalProfitLoss),
      );
    }

    return { weeks: items.map((item) => item.weekCode) };
  }

  useEffect(() => {
    if (activeTab !== "week-detail" || !week) return;
    const key = cacheKey(market.id, week, "player-raw-upload");
    if (getCachedReport(key)) return;

    let cancelled = false;
    void loadCached(key, async (): Promise<CachedTabData> => {
      const result = await api.getReport({
        marketId: market.id,
        week,
        tabId: "player-raw-upload",
      });
      return {
        rows: result.dataset?.rows ?? [],
        fileName: result.dataset?.fileName ?? "",
        location: result.dataset?.location ?? "",
        columns:
          result.dataset?.columns && result.dataset.columns.length > 0
            ? result.dataset.columns
            : TAB_COLUMNS["player-raw-upload"],
      };
    })
      .then(() => {
        if (!cancelled) setPlayerRawRangeTick((tick) => tick + 1);
      })
      .catch(() => {
        // ISO week range is already shown when Player Raw dates are missing.
      });

    return () => {
      cancelled = true;
    };
  }, [activeTab, market.id, week]);

  useEffect(() => {
    if (activeTab === "history" || activeTab === "database") {
      setLoadingData(false);
      return;
    }

    const key = cacheKey(
      market.id,
      isAllWeeksTab(activeTab) ? ALL_WEEKS_CACHE_WEEK : week,
      activeTab,
    );
    // Week Detail and Weekly Summary always reloads from API so game columns /
    // NCF edits stay in sync with Aff Raw + Player Raw sources.
    if (
      activeTab !== "week-detail" &&
      activeTab !== "weekly-summary" &&
      getCachedReport(key)
    ) {
      setLoadingData(false);
      return;
    }

    const requestId = ++requestIdRef.current;
    let cancelled = false;

    async function loadSavedData() {
      setLoadingData(true);
      try {
        // Week Detail / Weekly Summary always bypass loadCached so we never
        // show a stale Net or NCF after
        // re-upload / formula changes.
        const data =
          activeTab === "week-detail"
            ? await (async () => {
                // Load saved rows as-is (with formula recalc for non-base).
                // Do NOT re-sync Last Week NCF from the previous week here —
                // that overwrote manual NCF edits whenever the user switched
                // weeks and came back. Carry-over is pushed forward only when
                // the previous week is saved (cascadeNegativeCarryOver).
                const viewProfile = profileForWeek(week);
                const wd = await loadWeekDetailRows(market.id, week, {
                  profile: viewProfile,
                });
                const result = {
                  rows: wd.rows,
                  fileName: wd.fileName,
                  location: wd.location,
                  columns: [
                    ...weekDetailColumnsForMarket(
                      market.id,
                      viewProfile.totalProfitLoss,
                    ),
                  ],
                };
                setCachedReport(key, result);
                return result;
              })()
            : activeTab === "weekly-summary"
              ? await (async () => {
                  const result = await loadWeeklySummaryAllWeeks(market.id);
                  setCachedReport(key, result);
                  return result;
                })()
            : await loadCached(key, async (): Promise<CachedTabData> => {
          if (activeTab === "business-raw") {
            return loadBusinessRawAllWeeks(market.id);
          }
          if (activeTab === "aff-su") {
            return loadAffSuAllWeeks(market.id);
          }
          if (activeTab === "bad-aff") {
            const result = await api.getReport({
              marketId: market.id,
              week,
              tabId: "bad-aff",
            });
            return {
              rows: (result.dataset?.rows ?? []).map((row) =>
                normalizeBadAffRow(row, market.id, profileForWeek(week).totalProfitLoss),
              ),
              fileName: "",
              location: "",
              columns: columnsForTab(
                "bad-aff",
                market.id,
                profileForWeek(week).totalProfitLoss,
              ),
            };
          }
          if (activeTab === "paid-comm") {
            // Always derive from current Week Detail so auto-Paid rows flow in.
            const wd = await loadWeekDetailRows(market.id, week, {
              profile: profileForWeek(week),
            });
            return {
              rows: derivePaidComm(week, wd.rows),
              fileName: "",
              location: "",
              columns: columnsForTab("paid-comm", market.id),
            };
          }
          if (activeTab === "adjustment-notes") {
            const result = await api.getReport({
              marketId: market.id,
              week,
              tabId: "adjustment-notes",
            });
            const toCols = weekDetailColumnsForMarket(
              market.id,
              profileForWeek(week).totalProfitLoss,
            );
            const fromCols =
              result.dataset?.columns && result.dataset.columns.length > 0
                ? result.dataset.columns
                : TAB_COLUMNS["adjustment-notes"];
            return {
              rows: remapRowsToColumns(
                result.dataset?.rows ?? [],
                fromCols,
                toCols,
              ),
              fileName: "",
              location: "",
              columns: toCols,
            };
          }
          const result = await api.getReport({
            marketId: market.id,
            week,
            tabId: activeTab,
          });
          return {
            rows: result.dataset?.rows ?? [],
            fileName: result.dataset?.fileName ?? "",
            location: result.dataset?.location ?? "",
            columns:
              result.dataset?.columns && result.dataset.columns.length > 0
                ? result.dataset.columns
                : columnsForTab(activeTab, market.id),
          };
        });

        if (cancelled || requestId !== requestIdRef.current) return;
        setTableRows(data.rows);
        setTableColumns(
          data.columns && data.columns.length > 0
            ? data.columns
            : columnsForTab(activeTab, market.id, profileForWeek(week).totalProfitLoss),
        );
        if (isRawUploadTabId(activeTab)) setUploadName(data.fileName);
      } catch (error) {
        if (cancelled || requestId !== requestIdRef.current) return;
        console.error(error);
        setImportMessage(error instanceof Error ? error.message : "Failed to load saved data");
      } finally {
        if (!cancelled && requestId === requestIdRef.current) setLoadingData(false);
      }
    }

    void loadSavedData();
    return () => {
      cancelled = true;
    };
  }, [activeTab, market.id, week, canImportExport, commissionSettings]);

  useEffect(() => {
    setSelectedVisibleIndices(new Set());
    setBulkRejectOpen(false);
    setGridPage(1);
  }, [activeTab, market.id, week, filters]);

  useEffect(() => {
    setSelectedVisibleIndices((current) => {
      if (current.size === 0) return current;
      const next = new Set<number>();
      for (const index of current) {
        if (index >= 0 && index < visibleRows.length) next.add(index);
      }
      return next.size === current.size ? current : next;
    });
  }, [visibleRows.length]);

  async function openRawSourcePicker(file: File, tabId: RawUploadTabId | null) {
    setImportMessage(null);
    setReadingFile(true);
    try {
      const parsed = await parseWorkbookFile(file);
      if (parsed.sheetNames.length === 0) {
        setImportMessage("No sheets found in this file.");
        return;
      }
      setPendingUploadTab(tabId);
      setPendingWorkbook(parsed);
      setUploadName(file.name);
    } catch (error) {
      console.error(error);
      setImportMessage("Failed to read Excel file.");
    } finally {
      setReadingFile(false);
    }
  }

  async function handleBaseWeekDetailUpload(file: File) {
    setImportMessage(null);
    setBaseUploading(true);
    try {
      const parsed = await parseWorkbookFile(file);
      const hintedWeek = file.name.match(/(\d{4})\s*W\s*(\d{1,2})/i);
      const hintCode = hintedWeek
        ? `${hintedWeek[1]}W${hintedWeek[2].padStart(2, "0")}`
        : week;
      let importProfile = profileForWeek(hintCode);
      let imported = importBaseWeekDetailSheet(
        parsed,
        undefined,
        undefined,
        file.name,
        market.id,
        importProfile,
      );
      const exactProfile = profileForWeek(imported.week);
      if (exactProfile.totalProfitLoss !== importProfile.totalProfitLoss) {
        importProfile = exactProfile;
        imported = importBaseWeekDetailSheet(
          parsed,
          undefined,
          undefined,
          file.name,
          market.id,
          importProfile,
        );
      }
      const weekCode = imported.week;
      const rows = finalizeBaseWeekDetail(
        imported.rows,
        imported.uploadedNextNcf,
        market.id,
        importProfile,
      );
      if (rows.length === 0) {
        throw new Error("No affiliate rows found in the base Week Detail file.");
      }

      const nextWeek = nextWeekCode(weekCode);

      setCachedReport(cacheKey(market.id, weekCode, "week-detail"), {
        rows,
        fileName: file.name,
        location: BASE_WEEK_DETAIL_LOCATION,
        columns: weekDetailColumnsForMarket(
          market.id,
          importProfile.totalProfitLoss,
        ),
      });

      const cascadeResult = await cascadeNegativeCarryOver(weekCode, rows, {
        historyAction: "import",
        historyLabel: `Uploaded base Week Detail for ${weekCode} (carry-over seed${
          nextWeek ? ` for ${nextWeek}` : ""
        }) from ${imported.sheetName}`,
        updateCurrentView: false,
        captureUndo: false,
        forceCascadeAll: true,
        fileName: file.name,
      });
      const recalculatedLaterWeeks = cascadeResult.weeks.filter((wk) => wk !== weekCode);

      setWeekOptions((current) => {
        const merged = new Set([...current, ...cascadeResult.weeks]);
        return [...merged].sort((a, b) => b.localeCompare(a));
      });

      // Show uploaded rows in Week Detail immediately (no raw files needed).
      setWeek(weekCode);
      setActiveTab("week-detail");
      setTableRows(rows);
      setTableColumns(
        weekDetailColumnsForMarket(market.id, importProfile.totalProfitLoss),
      );
      setUploadName(file.name);
      setFilters({});

      const missingHint =
        imported.missingColumns.length > 0
          ? ` Missing columns mapped blank: ${imported.missingColumns.slice(0, 6).join(", ")}${
              imported.missingColumns.length > 6 ? "…" : ""
            }.`
          : "";

      setImportMessage(
        `Base Week Detail loaded for ${market.label} · ${weekCode} (${rows.length} affiliates) — values kept as uploaded.` +
          (recalculatedLaterWeeks.length > 0
            ? ` Recalculated ${recalculatedLaterWeeks.length} later week(s) (${recalculatedLaterWeeks[0]}–${recalculatedLaterWeeks[recalculatedLaterWeeks.length - 1]}) for negative carry-over.`
            : nextWeek
              ? ` Import ${nextWeek} raw files next — Last Week NCF will use this base.`
              : "") +
          missingHint,
      );
    } catch (error) {
      console.error(error);
      setImportMessage(
        error instanceof Error ? error.message : "Failed to upload base Week Detail",
      );
    } finally {
      setBaseUploading(false);
    }
  }

  async function handleBaseWeeklySummaryUpload(file: File) {
    setImportMessage(null);
    setBaseSummaryUploading(true);
    try {
      const parsed = await parseWorkbookFile(file);
      const imported = importBaseWeeklySummarySheet(parsed);
      const columns = [...WEEKLY_KPI_COLUMNS];
      const items = imported.weeks.map((weekCode) => ({
        tabId: "weekly-summary" as const,
        week: weekCode,
        category: BASE_WEEK_DETAIL_CATEGORY,
        columns,
        rows: [imported.rowsByWeek.get(weekCode)!],
        sheetName: imported.sheetName,
        location: BASE_WEEK_SUMMARY_LOCATION,
      }));

      const lastWeek = imported.weeks[imported.weeks.length - 1]!;
      const lastRow = imported.rowsByWeek.get(lastWeek)!;
      const totalAffIndex = columns.indexOf("Total Aff");
      const seedTotalAff =
        totalAffIndex >= 0
          ? String(lastRow[totalAffIndex] ?? "").replace(/,/g, "").trim()
          : "";

      await api.saveReportsBulk({
        marketId: market.id,
        week: lastWeek,
        fileName: file.name,
        historyAction: "import",
        historyLabel: `Uploaded base Weekly Summary (${imported.weeks.length} week(s), ${imported.weeks[0]}–${lastWeek}; Total Aff carry-over seed ${seedTotalAff}) from ${imported.sheetName}`,
        items,
      });

      const summaryKey = cacheKey(
        market.id,
        WEEKLY_SUMMARY_CACHE_WEEK,
        "weekly-summary",
      );
      clearReportCache();
      const loaded = await loadWeeklySummaryAllWeeks(market.id);
      setCachedReport(summaryKey, loaded);

      setWeekOptions((current) => {
        const merged = new Set([...current, ...imported.weeks]);
        return [...merged].sort((a, b) => b.localeCompare(a));
      });

      setWeek(lastWeek);
      setActiveTab("weekly-summary");
      setTableRows(loaded.rows);
      setTableColumns(loaded.columns ?? columns);
      setUploadName(file.name);

      const missingHint =
        imported.missingColumns.length > 0
          ? ` Unmapped columns: ${imported.missingColumns.slice(0, 6).join(", ")}${
              imported.missingColumns.length > 6 ? "…" : ""
            }.`
          : "";

      setImportMessage(
        `Uploaded base Weekly Summary for ${imported.weeks.length} week(s) (${imported.weeks[0]}–${lastWeek}). Total Aff carry-over seed: ${seedTotalAff || "—"} at ${lastWeek}.${missingHint}`,
      );
    } catch (error) {
      console.error(error);
      setImportMessage(
        error instanceof Error
          ? error.message
          : "Failed to upload base Weekly Summary",
      );
    } finally {
      setBaseSummaryUploading(false);
    }
  }

  async function handleWeeklyImport(selectedSheets: string[]) {
    if (!pendingWorkbook) return;
    const workbook = pendingWorkbook;
    const uploadTab = pendingUploadTab;
    // Close modal immediately so the UI doesn't look frozen on the confirm screen.
    setPendingWorkbook(null);
    setPendingUploadTab(null);
    setSavingData(true);
    setSaveProgress("Reading sheets…");
    setImportMessage(null);

    try {
      const imported = importAllSourceSheets(
        workbook,
        selectedSheets,
        uploadTab ?? undefined,
      );

      const importedSourceTabs = new Set(
        imported.detectedSheets
          .map((item) => item.tabId)
          .filter((tabId): tabId is RawUploadTabId => isRawUploadTabId(tabId)),
      );

      const importedRowCount = RAW_UPLOAD_TABS.reduce(
        (count, tabId) => count + (imported[tabId]?.length ?? 0),
        0,
      );
      if (importedRowCount === 0 && imported.affSuAll.length === 0) {
        throw new Error(
          "No raw rows imported. Upload Aff Raw, Player Raw, System Comm Raw, Aff SU, or Business Raw.",
        );
      }

      // Auto-detect week from Month/Week column — import that week only.
      const targetWeek = pickPrimaryWeekFromImported(
        imported,
        // Aff SU-only uploads: fall back to the week currently selected in the toolbar.
        week,
      );
      const weekList = [targetWeek];

      const rowsByTabWeek = new Map<RawUploadTabId, Map<string, string[][]>>();
      for (const tabId of importedSourceTabs) {
        const rows = imported[tabId] ?? [];
        rowsByTabWeek.set(
          tabId,
          splitRowsByWeek(
            tabId,
            rows,
            weekList,
            targetWeek,
            imported.sourceColumns[tabId] ?? TAB_COLUMNS[tabId],
          ),
        );
      }

      const targetRowCount = [...importedSourceTabs].reduce((count, tabId) => {
        if (tabId === "aff-su") return count + (imported.affSuAll.length > 0 ? 1 : 0);
        return (
          count + (rowsByTabWeek.get(tabId)?.get(targetWeek)?.length ?? 0)
        );
      }, 0);
      if (targetRowCount === 0 && imported.affSuAll.length === 0) {
        throw new Error(
          `No raw rows for detected week ${targetWeek} in the selected sheets. Check the Month/Week column.`,
        );
      }

      type BulkItem = {
        tabId: ReportTabId;
        week?: string;
        columns: string[];
        rows: string[][];
        sheetName: string | null;
      };

      const allItems: BulkItem[] = [];
      const allKpiRows: string[][] = [];
      let totalWeekDetailRows = 0;
      let focusWeek = weekList[weekList.length - 1]!;
      let focusWeekDetail: string[][] = [];
      let focusSources: Partial<Record<ReportTabId, string[][]>> = {};

      // Merge Aff SU history (imported file + saved DB) for weekly New Sign Up counts.
      const existingAffSu = await loadAffSuAllWeeks(market.id);
      const affSuSeen = new Set<string>();
      const affSuCombined: string[][] = [];
      for (const row of [
        ...existingAffSu.rows,
        ...(imported.affSuAll.length > 0
          ? imported.affSuAll
          : (imported["aff-su"] ?? [])),
      ]) {
        const key = row.map((cell) => String(cell ?? "").trim()).join("\u0001");
        if (!key || affSuSeen.has(key)) continue;
        affSuSeen.add(key);
        affSuCombined.push(row);
      }

      const summaryRowsByWeek = new Map<string, string[]>();
      const baseSummaryRowsByWeek = new Map<string, string[]>();
      try {
        const summaryTab = await api.getReportsByTab({
          marketId: market.id,
          tabId: "weekly-summary",
        });
        for (const dataset of summaryTab.datasets) {
          if (!isKpiDataset(dataset.columns, dataset.rows)) continue;
          const isBase =
            isBaseWeeklySummaryCategory(dataset.category) ||
            isBaseWeeklySummaryLocation(dataset.location);
          for (const row of dataset.rows ?? []) {
            const weekKey = String(row[0] ?? dataset.week ?? "")
              .trim()
              .toUpperCase();
            if (!/^\d{4}W\d{2}$/i.test(weekKey)) continue;
            summaryRowsByWeek.set(weekKey, row);
            if (isBase) baseSummaryRowsByWeek.set(weekKey, row);
          }
        }
      } catch {
        // Non-fatal — fall back to Aff SU-only cumulative Total Aff.
      }
      const { seedWeek, seedTotalAff } =
        readBaseWeeklySummarySeed(baseSummaryRowsByWeek);

      for (let wi = 0; wi < weekList.length; wi += 1) {
        const weekCode = weekList[wi]!;
        setSaveProgress(
          `Computing ${weekCode} (${wi + 1}/${weekList.length})…`,
        );
        // Let the progress toast paint before heavy sync work.
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));

        const sources: Partial<Record<ReportTabId, string[][]>> = {};
        const sourceColumns: Partial<Record<ReportTabId, string[]>> = {};

        for (const tabId of SOURCE_TABS) {
          if (tabId === "paid-comm") continue;

          if (importedSourceTabs.has(tabId as RawUploadTabId)) {
            sources[tabId] =
              rowsByTabWeek.get(tabId as RawUploadTabId)?.get(weekCode) ?? [];
            const layout = imported.sourceColumns[tabId as RawUploadTabId];
            if (layout && layout.length > 0) sourceColumns[tabId] = layout;
            continue;
          }

          const existingKey = cacheKey(market.id, weekCode, tabId);
          const cached = getCachedReport(existingKey);
          if (cached) {
            sources[tabId] = cached.rows;
            if (cached.columns && cached.columns.length > 0) {
              sourceColumns[tabId] = cached.columns;
            }
            continue;
          }

          const existing = await api.getReport({
            marketId: market.id,
            week: weekCode,
            tabId,
          });
          sources[tabId] = existing.dataset?.rows ?? [];
          const existingColumns = existing.dataset?.columns;
          setCachedReport(existingKey, {
            rows: sources[tabId] ?? [],
            fileName: existing.dataset?.fileName ?? "",
            location: "",
            columns: existingColumns,
          });
          if (existingColumns && existingColumns.length > 0) {
            sourceColumns[tabId] = existingColumns;
          }
        }

        if (imported.affSuAll.length > 0) {
          sources["aff-su"] = imported.affSuAll;
        }

        const prevWeek = previousWeekCode(weekCode);
        let prevWeekDetail: string[][] = [];
        if (prevWeek) {
          const prevKey = cacheKey(market.id, prevWeek, "week-detail");
          const cachedPrev = getCachedReport(prevKey);
          if (cachedPrev) {
            prevWeekDetail = cachedPrev.rows;
          } else {
            // Don't re-normalize the previous week — we only need Next Week NCF.
            const prevLoaded = await loadWeekDetailRows(market.id, prevWeek, {
              normalize: false,
              profile: profileForWeek(prevWeek),
            });
            prevWeekDetail = prevLoaded.rows;
            setCachedReport(prevKey, {
              rows: prevWeekDetail,
              fileName: prevLoaded.fileName,
              location: prevLoaded.location,
            });
          }
        }

        // computeWeeklyDetail already applies Comm % / FINAL NET formulas.
        // If this week already has a base upload, keep it — do not replace with raw compute.
        const weekProfile = profileForWeek(weekCode);
        const existingWeekDetail = await loadWeekDetailRows(market.id, weekCode, {
          normalize: false,
          profile: weekProfile,
        });
        const keepBase = isBaseWeekDetailLocation(existingWeekDetail.location);
        const keepBaseSummary = baseSummaryRowsByWeek.has(
          weekCode.toUpperCase(),
        );

        const weekDetail = keepBase
          ? existingWeekDetail.rows
          : computeWeeklyDetail({
              week: weekCode,
              sources: {
                ...sources,
                "aff-su":
                  imported.affSuAll.length > 0
                    ? imported.affSuAll
                    : sources["aff-su"],
              },
              prevWeekDetail,
              sourceColumns,
              marketId: market.id,
              profile: weekProfile,
            });

        // Cache immediately so the next week in this import gets the carry-over.
        setCachedReport(cacheKey(market.id, weekCode, "week-detail"), {
          rows: weekDetail,
          fileName: keepBase
            ? existingWeekDetail.fileName || workbook.fileName
            : workbook.fileName,
          location: keepBase ? BASE_WEEK_DETAIL_LOCATION : "",
          columns: weekDetailColumnsForMarket(market.id, weekProfile.totalProfitLoss),
        });

        if (weekDetail.length === 0) {
          for (const tabId of importedSourceTabs) {
            allItems.push({
              tabId,
              week: weekCode,
              columns: imported.sourceColumns[tabId] ?? TAB_COLUMNS[tabId],
              rows: sources[tabId] ?? [],
              sheetName:
                imported.detectedSheets.find((d) => d.tabId === tabId)?.sheetName ??
                null,
            });
          }
          continue;
        }

        const paidComm = derivePaidComm(weekCode, weekDetail);
        sources["paid-comm"] = paidComm;
        totalWeekDetailRows += weekDetail.length;

        const prevTotalAff = resolvePrevTotalAffForWeek(
          weekCode.toUpperCase(),
          summaryRowsByWeek,
          seedWeek,
          seedTotalAff,
        );
        const kpiRow = computeWeeklyKpi({
          week: weekCode,
          sources,
          paidComm,
          weekDetail,
          prevTotalAff: prevTotalAff ?? undefined,
          sourceColumns,
        });
        if (!keepBaseSummary) {
          summaryRowsByWeek.set(weekCode.toUpperCase(), kpiRow);
        }
        allKpiRows.push(kpiRow);

        for (const tabId of importedSourceTabs) {
          allItems.push({
            tabId,
            week: weekCode,
            columns: imported.sourceColumns[tabId] ?? TAB_COLUMNS[tabId],
            rows: sources[tabId] ?? [],
            sheetName:
              imported.detectedSheets.find((d) => d.tabId === tabId)?.sheetName ?? null,
          });
        }

        allItems.push({
          tabId: "paid-comm",
          week: weekCode,
          columns: TAB_COLUMNS["paid-comm"],
          rows: paidComm,
          sheetName: "derived-from-week-detail",
        });

        if (!keepBase) {
          allItems.push(
            {
              tabId: "week-detail",
              week: weekCode,
              columns: weekDetailColumnsForMarket(market.id, weekProfile.totalProfitLoss),
              rows: weekDetail,
              sheetName: weekCode,
            },
            ...(keepBaseSummary
              ? []
              : [
                  {
                    tabId: "weekly-summary" as const,
                    week: weekCode,
                    columns: TAB_COLUMNS["weekly-summary"],
                    rows: [kpiRow],
                    sheetName: "Weekly Summary",
                  },
                ]),
          );
        } else if (!keepBaseSummary) {
          allItems.push({
            tabId: "weekly-summary",
            week: weekCode,
            columns: TAB_COLUMNS["weekly-summary"],
            rows: [kpiRow],
            sheetName: "Weekly Summary",
          });
        }

        focusWeek = weekCode;
        focusWeekDetail = weekDetail;
        focusSources = sources;
      }

      if (allItems.length === 0) {
        throw new Error(
          `Could not import weeks (${weekList.join(", ")}). Check Aff SU / Aff Raw data.`,
        );
      }

      for (let i = 0; i < weekList.length; i += 1) {
        const weekCode = weekList[i]!;
        const weekItems = allItems.filter((item) => item.week === weekCode);
        if (weekItems.length === 0) continue;

        setSaveProgress(`Saving ${weekCode} (${i + 1}/${weekList.length})…`);
        await api.saveReportsBulk({
          marketId: market.id,
          week: weekCode,
          fileName: workbook.fileName,
          historyAction: "import",
          historyLabel:
            weekList.length === 1
              ? `Imported ${weekCode} from ${selectedSheets.join(", ")}`
              : `Imported ${weekCode} (${i + 1}/${weekList.length}: ${weekList.join(", ")}) from ${selectedSheets.join(", ")}`,
          items: weekItems,
        });
      }

      for (const item of allItems) {
        const itemWeek = item.week ?? focusWeek;
        setCachedReport(cacheKey(market.id, itemWeek, item.tabId), {
          rows: item.rows,
          fileName: workbook.fileName,
          location: "",
          columns: item.columns,
        });
      }

      const summaryKey = cacheKey(market.id, WEEKLY_SUMMARY_CACHE_WEEK, "weekly-summary");
      const existingSummary = getCachedReport(summaryKey);
      const mergedSummary = upsertWeeklySummaryRows(
        existingSummary?.rows ?? [],
        allKpiRows,
      ).map((row) => recalculateWeeklySummaryOthers(row, WEEKLY_KPI_COLUMNS));
      setCachedReport(summaryKey, {
        rows: mergedSummary,
        fileName: workbook.fileName,
        location: "",
        columns: [...WEEKLY_KPI_COLUMNS],
      });

      const businessRawAllKey = cacheKey(market.id, ALL_WEEKS_CACHE_WEEK, "business-raw");
      let mergedBusinessRaw = getCachedReport(businessRawAllKey)?.rows ?? [];
      if (importedSourceTabs.has("business-raw")) {
        setSaveProgress("Refreshing Business Raw…");
        const loadedBiz = await loadBusinessRawAllWeeks(market.id);
        mergedBusinessRaw = loadedBiz.rows;
        setCachedReport(businessRawAllKey, {
          rows: mergedBusinessRaw,
          fileName: loadedBiz.fileName || workbook.fileName,
          location: "",
        });
      }

      const affSuAllKey = cacheKey(market.id, ALL_WEEKS_CACHE_WEEK, "aff-su");
      let mergedAffSu = getCachedReport(affSuAllKey)?.rows ?? [];
      if (importedSourceTabs.has("aff-su") || imported.affSuAll.length > 0) {
        setSaveProgress("Refreshing Aff SU…");
        const loadedAffSu = await loadAffSuAllWeeks(market.id);
        mergedAffSu = loadedAffSu.rows;
        setCachedReport(affSuAllKey, {
          rows: mergedAffSu,
          fileName: loadedAffSu.fileName || workbook.fileName,
          location: "",
        });
      }

      setWeek(focusWeek);
      setWeekOptions((current) => {
        const merged = new Set<string>([...weekList, ...current]);
        return [...merged].sort((a, b) => b.localeCompare(a));
      });

      const stayOnTab =
        uploadTab && isRawUploadTabId(uploadTab) ? uploadTab : "week-detail";
      setActiveTab(stayOnTab);
      setTableRows(
        stayOnTab === "week-detail"
          ? focusWeekDetail
          : stayOnTab === "business-raw"
            ? mergedBusinessRaw
            : stayOnTab === "aff-su"
              ? mergedAffSu
              : (focusSources[stayOnTab] ?? focusWeekDetail),
      );
      setTableColumns(
        stayOnTab === "week-detail"
          ? columnsForTab("week-detail", market.id)
          : stayOnTab === "business-raw"
            ? columnsForTab("business-raw", market.id)
            : stayOnTab === "aff-su"
              ? columnsForTab("aff-su", market.id)
              : (imported.sourceColumns[stayOnTab as RawUploadTabId] ??
                columnsForTab(stayOnTab, market.id)),
      );
      setUploadName(workbook.fileName);

      setImportMessage(
        `Imported ${weekList.length} week(s) (${weekList.join(", ")}) from sheets: ${selectedSheets.join(", ")}. Week Detail rows: ${totalWeekDetailRows}. Showing ${focusWeek}.`,
      );
    } catch (error) {
      console.error(error);
      setImportMessage(error instanceof Error ? error.message : "Failed to import raw source file");
    } finally {
      setSavingData(false);
      setSaveProgress(null);
    }
  }

  function handleLogout() {
    void logout().then(() => {
      navigate("/login", { replace: true });
    });
  }

  /**
   * Merge rejected Week Detail rows into the current week's Bad Aff dataset.
   * Rows all belong to the selected `week` (Week Detail is single-week).
   * Returns both the previous and merged rows so the change can be undone.
   */
  async function computeBadAffMerge(rejectedRows: string[][]) {
    const existing = await api.getReport({
      marketId: market.id,
      week,
      tabId: "bad-aff",
    });
    const previous = (existing.dataset?.rows ?? []).map((row) =>
      normalizeBadAffRow(row, market.id, profileForWeek(week).totalProfitLoss),
    );
    const seen = new Set(
      previous.map((r) => r.map((c) => String(c ?? "").trim()).join("\u0001")),
    );
    const merged = previous.map((r) => [...r]);
    for (const row of rejectedRows) {
      const key = row.map((c) => String(c ?? "").trim()).join("\u0001");
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push([...row]);
    }
    return { previous: previous.map((r) => [...r]), merged };
  }

  /**
   * Upsert or remove one Week Detail row in Adjustment Notes, keyed by week +
   * affiliate username. The Week Detail row itself is left in place.
   */
  async function computeAdjustmentNotesSync(row: string[], keep: boolean) {
    const existing = await api.getReport({
      marketId: market.id,
      week,
      tabId: "adjustment-notes",
    });
    const previous = (existing.dataset?.rows ?? []).map((item) => [...item]);
    const key = weekDetailAffiliateKey(row);
    const merged = previous.filter(
      (item) => weekDetailAffiliateKey(item) !== key,
    );
    if (keep) merged.push([...row]);
    return { previous, merged };
  }

  async function persistWeekDetailRows(
    nextRows: string[][],
    message: string,
    options?: {
      captureUndo?: boolean;
      badAffRows?: string[][];
      badAffUndoRows?: string[][] | null;
      adjustmentNotesRows?: string[][];
      adjustmentNotesUndoRows?: string[][] | null;
    },
  ) {
    const captureUndo = options?.captureUndo !== false;
    if (captureUndo) {
      setWeekDetailUndo({
        marketId: market.id,
        week,
        rows: tableRows.map((row) => [...row]),
        badAffRows: options?.badAffUndoRows
          ? options.badAffUndoRows.map((row) => [...row])
          : null,
        adjustmentNotesRows: options?.adjustmentNotesUndoRows
          ? options.adjustmentNotesUndoRows.map((row) => [...row])
          : null,
      });
    }

    // Save current week and push Next Week NCF into later weeks.
    await cascadeNegativeCarryOver(week, nextRows, {
      historyLabel: message,
      updateCurrentView: true,
      captureUndo: false,
    });

    const paidComm = derivePaidComm(week, nextRows);

    const summaryKey = cacheKey(market.id, WEEKLY_SUMMARY_CACHE_WEEK, "weekly-summary");
    const existingSummary = getCachedReport(summaryKey);
    const existingSummaryRows = existingSummary?.rows ?? [];
    const existingSummaryColumns = [...WEEKLY_KPI_COLUMNS];
    const existingKpi =
      existingSummaryRows.find(
        (row) => String(row[0] ?? "").trim().toUpperCase() === week.toUpperCase(),
      ) ?? null;
    let nextKpiRows: string[][] | null = null;
    if (existingKpi) {
      const updated = [...existingKpi];
      const commissionIndex = existingSummaryColumns.indexOf("Commission");
      const netIndex = existingSummaryColumns.indexOf("Net");
      const ratioIndex = existingSummaryColumns.indexOf("Commission / Net");
      if (commissionIndex >= 0) {
        const pcFinalIndex = TAB_COLUMNS["paid-comm"].indexOf("Final Comm");
        const commission =
          pcFinalIndex >= 0
            ? paidComm.reduce(
                (sum, row) =>
                  sum +
                  (Number(
                    String(row[pcFinalIndex] ?? "").replace(/,/g, "").trim(),
                  ) || 0),
                0,
              )
            : 0;
        updated[commissionIndex] = String(Math.round(commission * 100) / 100);
        const net = Number(String(updated[netIndex] ?? "").replace(/,/g, "") || 0);
        if (ratioIndex >= 0) {
          updated[ratioIndex] =
            net === 0 ? "0%" : `${Math.round((commission / net) * 100)}%`;
        }
      }
      nextKpiRows = [updated];
    }

    if (nextKpiRows) {
      await api.saveReportsBulk({
        marketId: market.id,
        week,
        fileName: uploadName || null,
        historyAction: "edit",
        historyLabel: message,
        items: [
          {
            tabId: "weekly-summary",
            columns: existingSummaryColumns,
            rows: nextKpiRows,
            sheetName: "Weekly Summary",
          },
        ],
      });
      setCachedReport(cacheKey(market.id, week, "weekly-summary"), {
        rows: nextKpiRows,
        fileName: uploadName,
        location: "",
        columns: existingSummaryColumns,
      });
      setCachedReport(summaryKey, {
        rows: upsertWeeklySummaryRows(existingSummaryRows, nextKpiRows),
        fileName: uploadName,
        location: "",
        columns: existingSummaryColumns,
      });
    }
    if (options?.badAffRows) {
      await api.saveReportsBulk({
        marketId: market.id,
        week,
        fileName: uploadName || null,
        historyAction: "edit",
        historyLabel: message,
        items: [
          {
            tabId: "bad-aff",
            columns: badAffColumnsForMarket(market.id, profileForWeek(week).totalProfitLoss),
            rows: options.badAffRows,
            sheetName: "rejected-from-week-detail",
          },
        ],
      });
      setCachedReport(cacheKey(market.id, week, "bad-aff"), {
        rows: options.badAffRows,
        fileName: "",
        location: "",
        columns: badAffColumnsForMarket(market.id, profileForWeek(week).totalProfitLoss),
      });
    }
    if (options?.adjustmentNotesRows) {
      await api.saveReportsBulk({
        marketId: market.id,
        week,
        fileName: uploadName || null,
        historyAction: "edit",
        historyLabel: message,
        items: [
          {
            tabId: "adjustment-notes",
            columns: weekDetailColumnsForMarket(
              market.id,
              profileForWeek(week).totalProfitLoss,
            ),
            rows: options.adjustmentNotesRows,
            sheetName: "adjustment-from-week-detail",
          },
        ],
      });
      setCachedReport(cacheKey(market.id, week, "adjustment-notes"), {
        rows: options.adjustmentNotesRows,
        fileName: "",
        location: "",
        columns: weekDetailColumnsForMarket(
          market.id,
          profileForWeek(week).totalProfitLoss,
        ),
      });
    }
    setImportMessage(message);
  }

  async function persistWeeklySummaryRows(
    beforeRows: string[][],
    afterRows: string[][],
    message: string,
  ) {
    const beforeByWeek = new Map<string, string[]>();
    for (const row of beforeRows) {
      const wk = String(row[0] ?? "")
        .trim()
        .toUpperCase();
      if (wk) beforeByWeek.set(wk, row);
    }

    const changedWeeks: string[] = [];
    for (const row of afterRows) {
      const wk = String(row[0] ?? "")
        .trim()
        .toUpperCase();
      if (!wk) continue;
      const prev = beforeByWeek.get(wk);
      if (!prev || JSON.stringify(prev) !== JSON.stringify(row)) {
        changedWeeks.push(wk);
      }
    }

    for (const wk of changedWeeks) {
      const row = afterRows.find(
        (candidate) =>
          String(candidate[0] ?? "")
            .trim()
            .toUpperCase() === wk,
      );
      if (!row) continue;
      await api.saveReportsBulk({
        marketId: market.id,
        week: wk,
        fileName: uploadName || null,
        historyAction: "edit",
        historyLabel: message,
        items: [
          {
            tabId: "weekly-summary",
            columns,
            rows: [row],
            sheetName: "Weekly Summary",
          },
        ],
      });
    }

    const summaryKey = cacheKey(market.id, WEEKLY_SUMMARY_CACHE_WEEK, "weekly-summary");
    setCachedReport(summaryKey, {
      rows: afterRows,
      fileName: uploadName,
      location: "",
      columns,
    });
    setTableRows(afterRows);
    setImportMessage(message);
  }

  async function undoLastWeekDetailAction() {
    if (!canImportExport || undoingWeekDetail) return;
    if (
      !weekDetailUndo ||
      weekDetailUndo.marketId !== market.id ||
      weekDetailUndo.week !== week
    ) {
      setWeekDetailUndo(null);
      return;
    }

    const previousRows = weekDetailUndo.rows.map((row) => [...row]);
    const previousBadAff = weekDetailUndo.badAffRows
      ? weekDetailUndo.badAffRows.map((row) => [...row])
      : null;
    const previousAdjustmentNotes = weekDetailUndo.adjustmentNotesRows
      ? weekDetailUndo.adjustmentNotesRows.map((row) => [...row])
      : null;
    setWeekDetailUndo(null);
    setUndoingWeekDetail(true);
    setSelectedVisibleIndices(new Set());
    try {
      await persistWeekDetailRows(previousRows, "Undid last Week Detail change.", {
        captureUndo: false,
        ...(previousBadAff ? { badAffRows: previousBadAff } : {}),
        ...(previousAdjustmentNotes
          ? { adjustmentNotesRows: previousAdjustmentNotes }
          : {}),
      });
    } catch (error) {
      console.error(error);
      setImportMessage(error instanceof Error ? error.message : "Failed to undo");
    } finally {
      setUndoingWeekDetail(false);
    }
  }

  function resolveActualIndices(visibleIndices: Iterable<number>): number[] {
    const actual = new Set<number>();
    for (const visibleIndex of visibleIndices) {
      const visibleRow = visibleRows[visibleIndex];
      const actualIndex =
        visibleRow != null ? tableRows.indexOf(visibleRow) : visibleIndex;
      if (actualIndex >= 0) actual.add(actualIndex);
    }
    return [...actual].sort((a, b) => a - b);
  }

  async function handleWeekDetailCellCommit(rowIndex: number, column: string, value: string) {
    if (activeTab !== "week-detail" || !canImportExport) return;

    const colIndex = columns.indexOf(column);
    if (colIndex < 0) return;

    const [actualIndex] = resolveActualIndices([rowIndex]);
    if (actualIndex == null || actualIndex < 0) return;

    const current = tableRows[actualIndex];
    if (!current) return;

    const isReject = column === "Status" && value === "Reject";
    if (column === "Adjustment") {
      const cleaned = String(value ?? "").replace(/,/g, "").trim();
      if (cleaned !== "") {
        const paren = /^\(\s*([\d.]+)\s*\)$/.exec(cleaned);
        const n = paren ? Number(paren[1]) : Number(cleaned);
        if (!Number.isFinite(n)) {
          setImportMessage("Adjustment must be a number.");
          return;
        }
      }
    }
    let nextRows: string[][];
    let rejectedRows: string[][] = [];

    if (isReject) {
      rejectedRows = [current];
      nextRows = tableRows.filter((_, index) => index !== actualIndex);
    } else {
      const draft = [...current];
      const raw =
        column === "Status" ? (value === "Paid" ? "Paid" : "Unpaid") : value;
      // Normalize numeric edits (commas / accounting negatives) before formulas.
      if (column !== "Status") {
        const cleaned = String(raw).replace(/,/g, "").trim();
        const paren = /^\(\s*([\d.]+)\s*\)$/.exec(cleaned);
        if (paren) {
          draft[colIndex] = String(-Math.abs(Number(paren[1]) || 0));
        } else {
          const n = Number(cleaned);
          draft[colIndex] = Number.isFinite(n) && cleaned !== "" ? String(n) : cleaned;
        }
      } else {
        draft[colIndex] = raw;
      }
      const isBase = isBaseWeekDetailLocation(
        getCachedReport(cacheKey(market.id, week, "week-detail"))?.location,
      );
      let recalculated =
        column === "Status" || isBase
          ? draft
          : recalculateWeeklyDetailRow(draft, market.id, profileForWeek(week));
      // Base uploads keep Next Week NCF from the file (carry-over seed).
      if (isBase && column !== "Status") {
        const iNextNcf = weekDetailColumnsForMarket(
          market.id,
          profileForWeek(week).totalProfitLoss,
        ).indexOf(
          "Next Week Negative Carry Over",
        );
        if (iNextNcf >= 0) {
          recalculated = [...recalculated];
          recalculated[iNextNcf] = current[iNextNcf] ?? "";
        }
      }
      nextRows = tableRows.map((row, index) =>
        index === actualIndex ? recalculated : row,
      );
    }

    try {
      if (isReject) {
        const { previous, merged } = await computeBadAffMerge(
          rejectedRows.map(toBadAffRow),
        );
        await persistWeekDetailRows(
          nextRows,
          `Rejected row ${actualIndex + 1} moved to Bad Aff. Paid Comm and Weekly Summary updated.`,
          { badAffRows: merged, badAffUndoRows: previous },
        );
        setSelectedVisibleIndices(new Set());
      } else {
        const persistOptions: {
          adjustmentNotesRows?: string[][];
          adjustmentNotesUndoRows?: string[][] | null;
        } = {};
        if (column === "Adjustment") {
          const edited = nextRows[actualIndex];
          if (edited) {
            const keep = rowHasAdjustment(edited);
            const { previous, merged } = await computeAdjustmentNotesSync(
              edited,
              keep,
            );
            persistOptions.adjustmentNotesRows = merged;
            persistOptions.adjustmentNotesUndoRows = previous;
          }
        }
        await persistWeekDetailRows(
          nextRows,
          `Updated ${column} for row ${actualIndex + 1} and recalculated formulas.`,
          persistOptions,
        );
      }
    } catch (error) {
      console.error(error);
      setImportMessage(error instanceof Error ? error.message : "Failed to save edit");
    }
  }

  async function handleWeeklySummaryCellCommit(
    rowIndex: number,
    column: string,
    value: string,
  ) {
    if (activeTab !== "weekly-summary" || !canImportExport) return;
    if (
      column !== "Total Aff" &&
      column !== "Dormant Aff"
    ) {
      return;
    }

    const [actualIndex] = resolveActualIndices([rowIndex]);
    if (actualIndex == null || actualIndex < 0) return;

    const current = tableRows[actualIndex];
    if (!current) return;

    const editedWeek = String(current[0] ?? "").trim();
    if (!editedWeek) return;

    const nextRows = applyWeeklySummaryAffCellEdit(
      tableRows,
      editedWeek,
      column,
      value,
      columns,
    );

    try {
      await persistWeeklySummaryRows(
        tableRows,
        nextRows,
        column === "Total Aff"
          ? `Updated Total Aff for ${editedWeek}; recalculated Dormant Aff and later weeks.`
          : `Updated Dormant Aff for ${editedWeek}.`,
      );
    } catch (error) {
      console.error(error);
      setImportMessage(error instanceof Error ? error.message : "Failed to save edit");
    }
  }

  async function applyBulkStatus(status: "Paid" | "Unpaid" | "Reject") {
    if (activeTab !== "week-detail" || !canImportExport || selectedVisibleIndices.size === 0) {
      return;
    }

    const statusCol = columns.indexOf("Status");
    if (statusCol < 0) return;

    const actualIndices = resolveActualIndices(selectedVisibleIndices);
    if (actualIndices.length === 0) return;

    let nextRows: string[][];
    let rejectedRows: string[][] = [];
    if (status === "Reject") {
      const remove = new Set(actualIndices);
      rejectedRows = actualIndices
        .map((index) => tableRows[index])
        .filter((row): row is string[] => Boolean(row));
      nextRows = tableRows.filter((_, index) => !remove.has(index));
    } else {
      nextRows = tableRows.map((row, index) => {
        if (!actualIndices.includes(index)) return row;
        const draft = [...row];
        draft[statusCol] = status;
        return draft;
      });
    }

    try {
      if (status === "Reject") {
        const { previous, merged } = await computeBadAffMerge(
          rejectedRows.map(toBadAffRow),
        );
        await persistWeekDetailRows(
          nextRows,
          `Rejected ${actualIndices.length} row(s) moved to Bad Aff. Paid Comm and Weekly Summary updated.`,
          { badAffRows: merged, badAffUndoRows: previous },
        );
      } else {
        await persistWeekDetailRows(
          nextRows,
          `Set ${actualIndices.length} row(s) to ${status}.`,
        );
      }
      setSelectedVisibleIndices(new Set());
      setBulkRejectOpen(false);
    } catch (error) {
      console.error(error);
      setImportMessage(error instanceof Error ? error.message : "Failed to save bulk update");
    }
  }

  function handleExportCsv() {
    if (activeTab === "history" || columns.length === 0) return;
    if (visibleRows.length === 0) {
      setImportMessage("Nothing to export — this table has no rows.");
      return;
    }

    exportTableCsv({
      columns,
      rows: visibleRows,
      filenameParts: [
        market.label,
        activeTab === "weekly-summary" ||
        activeTab === "business-raw" ||
        activeTab === "aff-su"
          ? "all-weeks"
          : week,
        activeLabel,
      ],
    });
    setImportMessage(
      `Exported ${visibleRows.length} row(s) from ${activeLabel} as CSV.`,
    );
  }

  if (!user) return null;

  if (capabilities?.mustSetup2fa) {
    return (
      <div className="login-shell">
        <header className="login-topbar">
          <div className="login-topbar-inner">
            <div className="brand-lockup">
              <BrandMark />
              <div className="brand-copy">
                <span className="brand-kicker">MR Database Tool</span>
                <span className="brand">Security setup</span>
              </div>
            </div>
          </div>
        </header>
        <main className="login-content">
          <TwoFactorSetup blocking />
        </main>
        <span className="mr-credit">Developed by Aris</span>
      </div>
    );
  }

  return (
    <div className={`mr-shell ${collapsed ? "sidebar-collapsed" : ""}`}>
      <ReportsSidebar
        activeMarketId={market.id}
        onSelectMarket={setMarket}
        collapsed={collapsed}
        onToggle={() => setCollapsed((value) => !value)}
        userLabel={user.name ?? user.email}
        role={user.role}
        onLogout={handleLogout}
      />

      <div className="mr-main">
        <ReportsTopBar
          week={week}
          weekOptions={weekOptions}
          onWeekChange={setWeek}
          activeTab={activeTab}
          onTabChange={(tab) => {
            setActiveTab(tab);
            setFilters({});
            setImportMessage(null);
          }}
        />

        <div className="mr-content">
          {activeTab === "history" ? (
            <HistoryPanel
              marketId={market.id}
              marketLabel={market.label}
              canRestore={canImportExport}
              onRestored={() => {
                clearReportCache();
                setImportMessage("History restored. Open another tab to reload data.");
              }}
            />
          ) : activeTab === "database" ? (
            <>
              <DatabasePanel
                marketId={market.id}
                marketLabel={market.label}
                canDelete={canImportExport}
                canUpload={canImportExport}
                canExport={canImportExport}
                rawUploadBusy={
                  readingFile || (savingData && !baseUploading && !baseSummaryUploading)
                }
                baseWeekDetailBusy={baseUploading}
                baseWeeklySummaryBusy={baseSummaryUploading}
                onPickFile={(file) => void openRawSourcePicker(file, null)}
                onPickBaseWeekDetail={(file) =>
                  void handleBaseWeekDetailUpload(file)
                }
                onPickBaseWeeklySummary={(file) =>
                  void handleBaseWeeklySummaryUpload(file)
                }
                commissionSettings={commissionSettings}
                onCommissionSettingsSaved={(settings) => {
                  setCommissionSettings(
                    sanitizeCommissionSettings(settings, market.id),
                  );
                  clearReportCache();
                }}
                onDeleted={() => {
                  clearReportCache();
                  void api
                    .getWeeks({ marketId: market.id })
                    .then((result) => {
                      const weeks = [
                        ...new Set(result.weeks.map((w) => w.toUpperCase())),
                      ].sort((a, b) => b.localeCompare(a));
                      setWeekOptions(weeks);
                      setWeek((current) => {
                        if (current && weeks.includes(current.toUpperCase())) {
                          return current.toUpperCase();
                        }
                        return weeks[0] ?? "";
                      });
                    })
                    .catch((error) => console.error(error));
                  setImportMessage(
                    "Data deleted. Open another tab to reload, or restore from History.",
                  );
                }}
              />
              <BackupPanel
                marketId={market.id}
                marketLabel={market.label}
                canManage={canImportExport}
                onRestored={() => {
                  clearReportCache();
                  setImportMessage(
                    "Backup restored. Open another tab to reload the data.",
                  );
                }}
              />
            </>
          ) : (
          <>
              <div
                className={`mr-table-stack${
                  rowViewMode === "scroll" ? "" : " is-page-rows"
                }`}
              >
              <div className="mr-toolbar">
                {isRawUploadTabId(activeTab) ? (
                  <>
                    <UploadPanel
                      title={RAW_UPLOAD_TITLES[activeTab]}
                      canUpload={canImportExport}
                      fileName={uploadName}
                      busy={readingFile || savingData}
                      onPickFile={(file) => void openRawSourcePicker(file, activeTab)}
                    />
                    {activeTab === "business-raw" ? (
                      <p className="mr-readonly-note">
                        Business Raw always shows all weeks (Date column), independent of the selected
                        week.
                      </p>
                    ) : null}
                    {activeTab === "aff-su" ? (
                      <p className="mr-readonly-note">
                        AFF SU always shows the full signup list from every week, independent of the
                        selected week.
                      </p>
                    ) : null}
                  </>
                ) : (
                  <section className="mr-upload">
                    <h2>{activeLabel.toUpperCase()}</h2>
                    <p className="mr-readonly-note">
                      {activeTab === "weekly-summary"
                        ? "Auto-computed KPI for all weeks from uploaded raw sources (Aff Raw, Player Raw, System Comm, Aff SU, Business Raw)."
                        : activeTab === "paid-comm"
                          ? "Auto-derived from Week Detail rows with Status = Paid."
                          : activeTab === "bad-aff"
                            ? "Affiliates rejected on the Week Detail tab, collected across all weeks."
                            : activeTab === "adjustment-notes"
                              ? "Week Detail rows with an Adjustment amount. Copied automatically when Adjustment is entered."
                            : "Shows saved Week Detail for the selected week. Computed weeks use raw uploads; a base Week Detail upload is stored as-is (not linked to raw) and seeds the next week's Last Week NCF."}
                    </p>
                  </section>
                )}

                {filterFields.length > 0 ? (
                  <AffiliateFilter
                    fields={filterFields}
                    values={filters}
                    usernameOptions={usernameOptions}
                    onChange={(id, value) =>
                      setFilters((current) => ({ ...current, [id]: value }))
                    }
                  />
                ) : null}
              </div>

              <div className="mr-section-block">
                <div className="mr-section-bar">
                  <div className="mr-section-label-group">
                    <span className="mr-section-label">
                      {`${market.label} · ${
                        isAllWeeksTab(activeTab) ? "all weeks" : week
                      }${
                        activeTab !== "week-detail" ? ` · ${activeLabel}` : ""
                      }${tableRows.length ? ` · ${visibleRows.length} rows` : ""}${
                        activeTab === "week-detail" && selectedVisibleIndices.size > 0
                          ? ` · ${selectedVisibleIndices.size} selected`
                          : ""
                      }`}
                    </span>
                    {activeTab === "week-detail" && weekDateRangeLabel ? (
                      <span className="mr-week-date-range">{weekDateRangeLabel}</span>
                    ) : null}
                  </div>
                  <div className="mr-section-controls">
                    <label className="mr-row-view">
                      <span className="mr-row-view-label">Rows</span>
                      <select
                        value={rowViewMode}
                        aria-label="Rows to show"
                        onChange={(event) => {
                          const next = event.target.value as RowViewMode;
                          setRowViewByTab((current) => ({
                            ...current,
                            [activeTab]: next,
                          }));
                          setGridPage(1);
                        }}
                      >
                        {ROW_VIEW_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    {gridPageSize != null && visibleRows.length > 0 ? (
                      <div className="mr-row-page">
                        <span className="mr-row-page-info">
                          {gridRangeStart.toLocaleString("en-US")}–
                          {gridRangeEnd.toLocaleString("en-US")} of{" "}
                          {visibleRows.length.toLocaleString("en-US")}
                        </span>
                        {gridTotalPages > 1 ? (
                          <div className="mr-row-page-actions">
                            <button
                              type="button"
                              className="mr-bulk-btn"
                              disabled={safeGridPage <= 1}
                              onClick={() =>
                                setGridPage((current) => Math.max(1, current - 1))
                              }
                            >
                              Prev
                            </button>
                            <button
                              type="button"
                              className="mr-bulk-btn"
                              disabled={safeGridPage >= gridTotalPages}
                              onClick={() =>
                                setGridPage((current) =>
                                  Math.min(gridTotalPages, current + 1),
                                )
                              }
                            >
                              Next
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  <div className="mr-section-actions">
                    {canImportExport && activeTab === "week-detail" ? (
                      <button
                        type="button"
                        className="mr-btn-secondary mr-bulk-btn"
                        disabled={
                          undoingWeekDetail ||
                          !weekDetailUndo ||
                          weekDetailUndo.marketId !== market.id ||
                          weekDetailUndo.week !== week
                        }
                        onClick={() => void undoLastWeekDetailAction()}
                        title={
                          weekDetailUndo?.marketId === market.id &&
                          weekDetailUndo.week === week
                            ? "Undo last Week Detail change"
                            : "Nothing to undo"
                        }
                      >
                        {undoingWeekDetail ? "Undoing…" : "Undo"}
                      </button>
                    ) : null}
                    {canImportExport && activeTab === "week-detail" && visibleRows.length > 0 ? (
                      <div className="mr-bulk-actions">
                        <button
                          type="button"
                          className="mr-btn-secondary mr-bulk-btn"
                          disabled={selectedVisibleIndices.size === 0}
                          onClick={() => void applyBulkStatus("Paid")}
                        >
                          Mark Paid
                        </button>
                        <button
                          type="button"
                          className="mr-btn-secondary mr-bulk-btn"
                          disabled={selectedVisibleIndices.size === 0}
                          onClick={() => void applyBulkStatus("Unpaid")}
                        >
                          Mark Unpaid
                        </button>
                        <button
                          type="button"
                          className="mr-btn-secondary mr-bulk-btn mr-bulk-reject"
                          disabled={selectedVisibleIndices.size === 0}
                          onClick={() => setBulkRejectOpen(true)}
                        >
                          Reject
                        </button>
                      </div>
                    ) : null}
                    <ExportButton
                      canExport={canImportExport}
                      onExport={visibleRows.length > 0 ? handleExportCsv : undefined}
                    />
                  </div>
                </div>

                {sectionTotals != null ? (
                  <div
                    className={`mr-section-totals${
                      sectionTotals.difference != null ? " is-detailed" : ""
                    }`}
                  >
                    <div className="mr-stat-chip">
                      <span className="mr-stat-label">Total Commission</span>
                      <strong className="mr-stat-value">
                        {Math.round(sectionTotals.commission).toLocaleString(
                          "en-US",
                        )}
                      </strong>
                    </div>
                    {sectionTotals.difference != null ? (
                      <div className="mr-stat-chip">
                        <span className="mr-stat-label">Total Difference</span>
                        <strong
                          className={`mr-stat-value${
                            sectionTotals.difference < 0 ? " is-negative" : ""
                          }`}
                        >
                          {Math.round(sectionTotals.difference).toLocaleString(
                            "en-US",
                          )}
                        </strong>
                      </div>
                    ) : null}
                    {sectionTotals.systemCommission != null ? (
                      <div className="mr-stat-chip">
                        <span className="mr-stat-label">
                          Total System Commission
                        </span>
                        <strong className="mr-stat-value">
                          {Math.round(
                            sectionTotals.systemCommission,
                          ).toLocaleString("en-US")}
                        </strong>
                      </div>
                    ) : null}
                    {sectionTotals.calculatedCommission != null ? (
                      <div className="mr-stat-chip">
                        <span className="mr-stat-label">
                          Total Calculated Commission
                        </span>
                        <strong
                          className={`mr-stat-value${
                            sectionTotals.calculatedCommission < 0
                              ? " is-negative"
                              : ""
                          }`}
                        >
                          {Math.round(
                            sectionTotals.calculatedCommission,
                          ).toLocaleString("en-US")}
                        </strong>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <DataGrid
                key={`grid-${market.id}-${activeTab}`}
                marketId={market.id}
                commissionProfile={profileForWeek(week)}
                columns={columns}
                rows={visibleRows}
                rowViewMode={rowViewMode}
                page={safeGridPage}
                onPageChange={setGridPage}
                canEdit={
                  canImportExport &&
                  (activeTab === "week-detail" || activeTab === "weekly-summary")
                }
                editableColumns={
                  activeTab === "week-detail"
                    ? WEEKLY_EDITABLE_COLUMNS
                    : activeTab === "weekly-summary"
                      ? WEEKLY_SUMMARY_EDITABLE_COLUMNS
                      : undefined
                }
                toggleColumns={
                  activeTab === "week-detail" || activeTab === "paid-comm"
                    ? WEEKLY_STATUS_TOGGLE_COLUMNS
                    : undefined
                }
                selectable={canImportExport && activeTab === "week-detail"}
                selectedIndices={selectedVisibleIndices}
                onSelectionChange={setSelectedVisibleIndices}
                defaultSortColumn={
                  activeTab === "week-detail" ? "Final Commission" : null
                }
                defaultSortDir={activeTab === "week-detail" ? "desc" : "asc"}
                sortPersistenceKey={`mr-grid-sort:${market.id}:${activeTab}`}
                dataBars={
                  activeTab === "business-raw" ? BUSINESS_RAW_DATA_BARS : null
                }
                onCellCommit={(rowIndex, column, value) => {
                  if (activeTab === "week-detail") {
                    void handleWeekDetailCellCommit(rowIndex, column, value);
                  } else if (activeTab === "weekly-summary") {
                    void handleWeeklySummaryCellCommit(rowIndex, column, value);
                  }
                }}
              />
              </div>
            </>
          )}
        </div>
        <span className="mr-credit">Developed by Aris</span>
      </div>

      {bulkRejectOpen ? (
        <div
          className="mr-modal-backdrop"
          role="presentation"
          onClick={() => setBulkRejectOpen(false)}
        >
          <div
            className="mr-modal mr-modal-wide"
            role="dialog"
            aria-modal="true"
            aria-labelledby="bulk-reject-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="mr-modal-header">
              <div>
                <h2 id="bulk-reject-title">Reject selected rows</h2>
              </div>
              <button
                type="button"
                className="mr-modal-close"
                onClick={() => setBulkRejectOpen(false)}
                aria-label="Close"
              >
                ×
              </button>
            </header>
            <div className="mr-modal-body">
              <p className="mr-modal-hint">
                Are you sure you want to reject {bulkRejectUsernames.length} selected row
                {bulkRejectUsernames.length === 1 ? "" : "s"}? This will delete them from Week
                Detail. Review the affiliate usernames below:
              </p>
              <div className="mr-reject-review">
                <p className="mr-reject-review-count">
                  {bulkRejectUsernames.length} username
                  {bulkRejectUsernames.length === 1 ? "" : "s"}
                </p>
                <ul className="mr-reject-username-list">
                  {bulkRejectUsernames.map((name, index) => (
                    <li key={`${name}-${index}`}>{name}</li>
                  ))}
                </ul>
              </div>
            </div>
            <footer className="mr-modal-footer">
              <button
                type="button"
                className="mr-btn-secondary"
                onClick={() => setBulkRejectOpen(false)}
              >
                No
              </button>
              <button
                type="button"
                className="mr-btn-primary"
                onClick={() => void applyBulkStatus("Reject")}
              >
                Yes, reject
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      <WeeklyImportModal
        open={Boolean(pendingWorkbook)}
        workbook={pendingWorkbook}
        lockedTabId={pendingUploadTab}
        onCancel={() => {
          setPendingWorkbook(null);
          setPendingUploadTab(null);
        }}
        onConfirm={(selectedSheets) => {
          void handleWeeklyImport(selectedSheets);
        }}
      />

      <div className="mr-toast-stack" aria-live="polite">
        {loadingData ? (
          <div className="mr-toast mr-toast-progress">
            <span className="mr-toast-spinner" aria-hidden />
            <span>Loading saved data…</span>
          </div>
        ) : null}
        {savingData ? (
          <div className="mr-toast mr-toast-progress">
            <span className="mr-toast-spinner" aria-hidden />
            <span>
              {saveProgress ??
                "Importing raw sources and calculating Weekly formulas…"}
            </span>
          </div>
        ) : null}
        {importMessage ? (
          <div
            className={`mr-toast ${
              /fail|error|incorrect|no (sheets|data|rows)|nothing/i.test(
                importMessage,
              )
                ? "mr-toast-error"
                : "mr-toast-info"
            }`}
            role="status"
          >
            <span>{importMessage}</span>
            <button
              type="button"
              className="mr-toast-close"
              aria-label="Dismiss"
              onClick={() => setImportMessage(null)}
            >
              ×
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
