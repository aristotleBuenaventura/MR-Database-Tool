import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import {
  REPORT_TABS,
  TAB_COLUMNS,
  WEEKLY_EDITABLE_COLUMNS,
  WEEKLY_KPI_COLUMNS,
  WEEKLY_MARKETS,
  WEEKLY_STATUS_TOGGLE_COLUMNS,
  WEEK_OPTIONS,
  type Market,
  type ReportTabId,
} from "../config/reports";
import { AffiliateFilter } from "../components/reports/AffiliateFilter";
import { DataGrid } from "../components/reports/DataGrid";
import { ExportButton } from "../components/reports/ExportButton";
import { ReportsSidebar } from "../components/reports/ReportsSidebar";
import { ReportsTopBar } from "../components/reports/ReportsTopBar";
import { UploadPanel } from "../components/reports/UploadPanel";
import { WeeklyImportModal } from "../components/reports/WeeklyImportModal";
import { parseWorkbookFile, type ParsedWorkbook } from "../lib/excel";
import { exportTableCsv } from "../lib/exportCsv";
import {
  cacheKey,
  clearReportCache,
  getCachedReport,
  loadCached,
  setCachedReport,
} from "../lib/reportCache";
import {
  computeWeeklyDetail,
  computeWeeklyKpi,
  derivePaidComm,
  normalizeWeekDetailStatuses,
  recalculateWeeklyDetailRow,
} from "../lib/weeklyCompute";
import {
  detectWeeksFromImported,
  importAllSourceSheets,
  isRawUploadTabId,
  previousWeekCode,
  splitRowsByWeek,
  type RawUploadTabId,
} from "../lib/weeklyImport";

const FILTER_PRESETS: Partial<Record<ReportTabId, { id: string; label: string }[]>> = {
  "week-detail": [
    { id: "affiliateUsername", label: "Affiliate Username" },
  ],
  "paid-comm": [
    { id: "affiliateUsername", label: "Affiliate Username" },
    { id: "week", label: "Week" },
  ],
  "system-comm-raw": [
    { id: "affiliateUsername", label: "Affiliate Username" },
    { id: "week", label: "Week" },
  ],
  "aff-raw-upload": [
    { id: "affiliateUsername", label: "Affiliate Username" },
    { id: "week", label: "Week" },
  ],
  "player-raw-upload": [
    { id: "affiliateUsername", label: "Affiliate Username" },
    { id: "week", label: "Week" },
  ],
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

function filterRows(
  rows: string[][],
  columns: string[],
  filters: Record<string, string | string[]>,
  filterFields: { id: string; label: string }[],
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
async function loadWeekDetailRows(marketId: string, week: string) {
  const primary = await api.getReport({ marketId, week, tabId: "week-detail" });
  if (primary.dataset?.rows?.length) {
    return {
      rows: normalizeWeekDetailStatuses(primary.dataset.rows),
      fileName: primary.dataset.fileName ?? "",
      location: primary.dataset.location ?? "",
    };
  }

  const legacy = await api.getReport({ marketId, week, tabId: "weekly-summary" });
  const cols = (legacy.dataset?.columns ?? []).map((c) => c.toLowerCase());
  const isWeekDetailShape =
    cols.includes("affiliate username") &&
    (cols.includes("final net") || cols.includes("final commission"));

  if (isWeekDetailShape && (legacy.dataset?.rows?.length ?? 0) > 0) {
    return {
      rows: normalizeWeekDetailStatuses(legacy.dataset!.rows),
      fileName: legacy.dataset?.fileName ?? "",
      location: legacy.dataset?.location ?? "",
    };
  }

  return { rows: [] as string[][], fileName: "", location: "" };
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
  const result = await api.getReportsByTab({
    marketId,
    tabId: "weekly-summary",
  });

  const byWeek = new Map<string, string[]>();
  let fileName = "";

  for (const dataset of result.datasets) {
    if (!isKpiDataset(dataset.columns, dataset.rows)) continue;
    if (!fileName && dataset.fileName) fileName = dataset.fileName;

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
      byWeek.set(weekKey, normalized);
    }
  }

  return {
    rows: sortWeeklySummaryRows([...byWeek.values()]),
    fileName,
    location: "",
  };
}

const WEEKLY_SUMMARY_CACHE_WEEK = "*";

export function MasterReportsPage() {
  const navigate = useNavigate();
  const { user, capabilities, logout } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [market, setMarket] = useState<Market>(WEEKLY_MARKETS[8]!);
  const [week, setWeek] = useState("2026W26");
  const [weekOptions, setWeekOptions] = useState<string[]>([...WEEK_OPTIONS]);
  const [activeTab, setActiveTab] = useState<ReportTabId>("week-detail");
  const [filters, setFilters] = useState<Record<string, string | string[]>>({});
  const [uploadName, setUploadName] = useState("");
  const [tableRows, setTableRows] = useState<string[][]>([]);
  const [pendingWorkbook, setPendingWorkbook] = useState<ParsedWorkbook | null>(null);
  const [pendingUploadTab, setPendingUploadTab] = useState<RawUploadTabId | null>(null);
  const [readingFile, setReadingFile] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [savingData, setSavingData] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [selectedVisibleIndices, setSelectedVisibleIndices] = useState<Set<number>>(
    () => new Set(),
  );
  const [bulkRejectOpen, setBulkRejectOpen] = useState(false);
  const requestIdRef = useRef(0);

  const canImportExport = Boolean(capabilities?.canImportExport);
  const tabMeta = REPORT_TABS.find((tab) => tab.id === activeTab);
  const activeLabel = tabMeta?.label ?? activeTab;
  const filterFields = FILTER_PRESETS[activeTab] ?? [];
  const columns = activeTab === "database" ? [] : TAB_COLUMNS[activeTab];
  const visibleRows = useMemo(
    () => filterRows(tableRows, columns, filters, filterFields),
    [tableRows, columns, filters, filterFields],
  );

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
    let cancelled = false;

    async function loadWeeks() {
      try {
        const result = await api.getWeeks({ marketId: market.id });
        if (cancelled) return;
        setWeekOptions((current) => {
          const merged = new Set<string>([
            ...result.weeks.map((w) => w.toUpperCase()),
            ...WEEK_OPTIONS,
            ...current,
          ]);
          return [...merged].sort((a, b) => b.localeCompare(a));
        });
      } catch (error) {
        console.error(error);
      }
    }

    void loadWeeks();
    return () => {
      cancelled = true;
    };
  }, [market.id]);

  useEffect(() => {
    if (activeTab === "database") {
      setTableRows([]);
      setLoadingData(false);
      return;
    }

    const dataWeek = activeTab === "weekly-summary" ? WEEKLY_SUMMARY_CACHE_WEEK : week;
    const key = cacheKey(market.id, dataWeek, activeTab);
    const cached = getCachedReport(key);
    if (cached) {
      setTableRows(
        activeTab === "week-detail"
          ? normalizeWeekDetailStatuses(cached.rows)
          : cached.rows,
      );
      if (isRawUploadTabId(activeTab)) setUploadName(cached.fileName);
      setLoadingData(false);
      return;
    }

    const requestId = ++requestIdRef.current;
    let cancelled = false;

    async function loadSavedData() {
      setLoadingData(true);
      try {
        const data = await loadCached(key, async () => {
          if (activeTab === "week-detail") {
            return loadWeekDetailRows(market.id, week);
          }
          if (activeTab === "weekly-summary") {
            return loadWeeklySummaryAllWeeks(market.id);
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
          };
        });

        if (cancelled || requestId !== requestIdRef.current) return;
        setTableRows(data.rows);
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
  }, [activeTab, market.id, week]);

  useEffect(() => {
    setSelectedVisibleIndices(new Set());
    setBulkRejectOpen(false);
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

  async function openRawSourcePicker(file: File, tabId: RawUploadTabId) {
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

  async function handleWeeklyImport(fallbackWeek: string, selectedSheets: string[]) {
    if (!pendingWorkbook) return;
    setSavingData(true);
    setImportMessage(null);

    try {
      const imported = importAllSourceSheets(
        pendingWorkbook,
        selectedSheets,
        pendingUploadTab ?? undefined,
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

      const weekList = detectWeeksFromImported(imported, fallbackWeek);
      if (weekList.length === 0) {
        throw new Error(
          `No week codes found. Set a fallback week like ${fallbackWeek} (YYYYWww).`,
        );
      }

      const rowsByTabWeek = new Map<RawUploadTabId, Map<string, string[][]>>();
      for (const tabId of importedSourceTabs) {
        const rows = imported[tabId] ?? [];
        rowsByTabWeek.set(
          tabId,
          splitRowsByWeek(tabId, rows, weekList, fallbackWeek),
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

      for (const weekCode of weekList) {
        const sources: Partial<Record<ReportTabId, string[][]>> = {};

        for (const tabId of SOURCE_TABS) {
          if (tabId === "paid-comm") continue;

          if (importedSourceTabs.has(tabId as RawUploadTabId)) {
            sources[tabId] =
              rowsByTabWeek.get(tabId as RawUploadTabId)?.get(weekCode) ?? [];
            continue;
          }

          const existingKey = cacheKey(market.id, weekCode, tabId);
          const cached = getCachedReport(existingKey);
          if (cached) {
            sources[tabId] = cached.rows;
            continue;
          }

          const existing = await api.getReport({
            marketId: market.id,
            week: weekCode,
            tabId,
          });
          sources[tabId] = existing.dataset?.rows ?? [];
          setCachedReport(existingKey, {
            rows: sources[tabId] ?? [],
            fileName: existing.dataset?.fileName ?? "",
            location: "",
          });
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
            const prevLoaded = await loadWeekDetailRows(market.id, prevWeek);
            prevWeekDetail = prevLoaded.rows;
            setCachedReport(prevKey, {
              rows: prevWeekDetail,
              fileName: prevLoaded.fileName,
              location: "",
            });
          }
        }

        const weekDetail = normalizeWeekDetailStatuses(
          computeWeeklyDetail({
            week: weekCode,
            sources: {
              ...sources,
              "aff-su":
                imported.affSuAll.length > 0 ? imported.affSuAll : sources["aff-su"],
            },
            prevWeekDetail,
          }),
        );

        if (weekDetail.length === 0) {
          // Still save raw sources for this week even if detail can't be built yet.
          for (const tabId of importedSourceTabs) {
            allItems.push({
              tabId,
              week: weekCode,
              columns: TAB_COLUMNS[tabId],
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

        const kpiRow = computeWeeklyKpi({
          week: weekCode,
          sources,
          paidComm,
        });
        allKpiRows.push(kpiRow);

        for (const tabId of importedSourceTabs) {
          allItems.push({
            tabId,
            week: weekCode,
            columns: TAB_COLUMNS[tabId],
            rows: sources[tabId] ?? [],
            sheetName:
              imported.detectedSheets.find((d) => d.tabId === tabId)?.sheetName ?? null,
          });
        }

        allItems.push(
          {
            tabId: "paid-comm",
            week: weekCode,
            columns: TAB_COLUMNS["paid-comm"],
            rows: paidComm,
            sheetName: "derived-from-week-detail",
          },
          {
            tabId: "week-detail",
            week: weekCode,
            columns: TAB_COLUMNS["week-detail"],
            rows: weekDetail,
            sheetName: weekCode,
          },
          {
            tabId: "weekly-summary",
            week: weekCode,
            columns: TAB_COLUMNS["weekly-summary"],
            rows: [kpiRow],
            sheetName: "Weekly Summary",
          },
        );

        focusWeek = weekCode;
        focusWeekDetail = weekDetail;
        focusSources = sources;
      }

      if (allItems.length === 0) {
        throw new Error(
          `Could not import weeks (${weekList.join(", ")}). Check Aff SU / Aff Raw data.`,
        );
      }

      await api.saveReportsBulk({
        marketId: market.id,
        week: focusWeek,
        fileName: pendingWorkbook.fileName,
        items: allItems,
      });

      for (const item of allItems) {
        const itemWeek = item.week ?? focusWeek;
        setCachedReport(cacheKey(market.id, itemWeek, item.tabId), {
          rows: item.rows,
          fileName: pendingWorkbook.fileName,
          location: "",
        });
      }

      const summaryKey = cacheKey(market.id, WEEKLY_SUMMARY_CACHE_WEEK, "weekly-summary");
      const existingSummary = getCachedReport(summaryKey);
      const mergedSummary = upsertWeeklySummaryRows(
        existingSummary?.rows ?? [],
        allKpiRows,
      );
      setCachedReport(summaryKey, {
        rows: mergedSummary,
        fileName: pendingWorkbook.fileName,
        location: "",
      });

      setWeek(focusWeek);
      setWeekOptions((current) => {
        const merged = new Set<string>([...weekList, ...current]);
        return [...merged].sort((a, b) => b.localeCompare(a));
      });

      const stayOnTab =
        pendingUploadTab && isRawUploadTabId(pendingUploadTab)
          ? pendingUploadTab
          : "week-detail";
      setActiveTab(stayOnTab);
      setTableRows(
        stayOnTab === "week-detail"
          ? focusWeekDetail
          : (focusSources[stayOnTab] ?? focusWeekDetail),
      );
      setPendingWorkbook(null);
      setPendingUploadTab(null);

      setImportMessage(
        `Imported ${weekList.length} week(s) (${weekList.join(", ")}) from sheets: ${selectedSheets.join(", ")}. Week Detail rows: ${totalWeekDetailRows}. Showing ${focusWeek}.`,
      );
    } catch (error) {
      console.error(error);
      setImportMessage(error instanceof Error ? error.message : "Failed to import raw source file");
    } finally {
      setSavingData(false);
    }
  }

  function handleLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  async function persistWeekDetailRows(nextRows: string[][], message: string) {
    setTableRows(nextRows);

    const paidComm = derivePaidComm(week, nextRows);

    const summaryKey = cacheKey(market.id, WEEKLY_SUMMARY_CACHE_WEEK, "weekly-summary");
    const existingSummaryRows = getCachedReport(summaryKey)?.rows ?? [];
    const existingKpi =
      existingSummaryRows.find(
        (row) => String(row[0] ?? "").trim().toUpperCase() === week.toUpperCase(),
      ) ?? null;
    let nextKpiRows: string[][] | null = null;
    if (existingKpi) {
      const updated = [...existingKpi];
      const commissionIndex = WEEKLY_KPI_COLUMNS.indexOf("Commission");
      const netIndex = WEEKLY_KPI_COLUMNS.indexOf("Net");
      const ratioIndex = WEEKLY_KPI_COLUMNS.indexOf("Commission / Net");
      if (commissionIndex >= 0) {
        const commission = paidComm.reduce(
          (sum, row) => sum + Number(String(row[4] ?? "").replace(/,/g, "") || 0),
          0,
        );
        updated[commissionIndex] = String(Math.round(commission));
        const net = Number(String(updated[netIndex] ?? "").replace(/,/g, "") || 0);
        if (ratioIndex >= 0) {
          updated[ratioIndex] =
            net > 0 || net === 0 ? "0" : String(Math.round(commission / net));
        }
      }
      nextKpiRows = [updated];
    }

    await api.saveReportsBulk({
      marketId: market.id,
      week,
      fileName: uploadName || null,
      items: [
        {
          tabId: "week-detail",
          columns: TAB_COLUMNS["week-detail"],
          rows: nextRows,
          sheetName: week,
        },
        {
          tabId: "paid-comm",
          columns: TAB_COLUMNS["paid-comm"],
          rows: paidComm,
          sheetName: "derived-from-week-detail",
        },
        ...(nextKpiRows
          ? [
              {
                tabId: "weekly-summary" as const,
                columns: TAB_COLUMNS["weekly-summary"],
                rows: nextKpiRows,
                sheetName: "Weekly Summary",
              },
            ]
          : []),
      ],
    });

    setCachedReport(cacheKey(market.id, week, "week-detail"), {
      rows: nextRows,
      fileName: uploadName,
      location: "",
    });
    setCachedReport(cacheKey(market.id, week, "paid-comm"), {
      rows: paidComm,
      fileName: uploadName,
      location: "",
    });
    if (nextKpiRows) {
      setCachedReport(cacheKey(market.id, week, "weekly-summary"), {
        rows: nextKpiRows,
        fileName: uploadName,
        location: "",
      });
      setCachedReport(summaryKey, {
        rows: upsertWeeklySummaryRows(existingSummaryRows, nextKpiRows),
        fileName: uploadName,
        location: "",
      });
    }
    setImportMessage(message);
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
    let nextRows: string[][];

    if (isReject) {
      nextRows = tableRows.filter((_, index) => index !== actualIndex);
    } else {
      const draft = [...current];
      draft[colIndex] =
        column === "Status" ? (value === "Paid" ? "Paid" : "Unpaid") : value;
      const recalculated =
        column === "Status" ? draft : recalculateWeeklyDetailRow(draft);
      nextRows = tableRows.map((row, index) =>
        index === actualIndex ? recalculated : row,
      );
    }

    try {
      await persistWeekDetailRows(
        nextRows,
        isReject
          ? `Rejected and removed row ${actualIndex + 1}. Paid Comm and Weekly Summary updated.`
          : `Updated ${column} for row ${actualIndex + 1} and recalculated formulas.`,
      );
      if (isReject) setSelectedVisibleIndices(new Set());
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
    if (status === "Reject") {
      const remove = new Set(actualIndices);
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
      await persistWeekDetailRows(
        nextRows,
        status === "Reject"
          ? `Rejected and removed ${actualIndices.length} row(s). Paid Comm and Weekly Summary updated.`
          : `Set ${actualIndices.length} row(s) to ${status}.`,
      );
      setSelectedVisibleIndices(new Set());
      setBulkRejectOpen(false);
    } catch (error) {
      console.error(error);
      setImportMessage(error instanceof Error ? error.message : "Failed to save bulk update");
    }
  }

  function handleExportCsv() {
    if (activeTab === "database" || columns.length === 0) return;
    if (visibleRows.length === 0) {
      setImportMessage("Nothing to export — this table has no rows.");
      return;
    }

    exportTableCsv({
      columns,
      rows: visibleRows,
      filenameParts: [
        market.label,
        activeTab === "weekly-summary" ? "all-weeks" : week,
        activeLabel,
      ],
    });
    setImportMessage(
      `Exported ${visibleRows.length} row(s) from ${activeLabel} as CSV.`,
    );
  }

  if (!user) return null;

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
          {loadingData ? <p className="mr-import-message">Loading saved data...</p> : null}
          {savingData ? (
            <p className="mr-import-message">Importing raw sources and calculating Weekly formulas...</p>
          ) : null}
          {importMessage ? <p className="mr-import-message">{importMessage}</p> : null}

          {activeTab === "database" ? (
            <section className="panel">
              <h2>DATABASE</h2>
              <p className="lede">
                Upload Aff Raw, Player Raw, System Comm Raw, Aff SU, and Business Raw on their own
                tabs. Week Detail, Paid Comm, and Weekly Summary are calculated automatically from
                those sources for the selected week (e.g. {week}).
              </p>
            </section>
          ) : (
            <>
              <div className="mr-toolbar">
                {isRawUploadTabId(activeTab) ? (
                  <UploadPanel
                    title={RAW_UPLOAD_TITLES[activeTab]}
                    canUpload={canImportExport}
                    fileName={uploadName}
                    busy={readingFile || savingData}
                    onPickFile={(file) => void openRawSourcePicker(file, activeTab)}
                  />
                ) : (
                  <section className="mr-upload">
                    <h2>{activeLabel.toUpperCase()}</h2>
                    <p className="mr-readonly-note">
                      {activeTab === "weekly-summary"
                        ? "Auto-computed KPI for all weeks from uploaded raw sources (Aff Raw, Player Raw, System Comm, Aff SU, Business Raw)."
                        : activeTab === "paid-comm"
                          ? "Auto-derived from Week Detail rows with Status = Paid."
                          : "Auto-computed from uploaded Aff Raw, Player Raw, System Comm Raw, Aff SU, and Business Raw. Upload those sources on their tabs."}
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

              <div className="mr-section-bar">
                <span className="mr-section-label">
                  {`${market.label} · ${week}${
                    activeTab !== "week-detail" ? ` · ${activeLabel}` : ""
                  }${tableRows.length ? ` · ${visibleRows.length} rows` : ""}${
                    activeTab === "week-detail" && selectedVisibleIndices.size > 0
                      ? ` · ${selectedVisibleIndices.size} selected`
                      : ""
                  }`}
                </span>
                <div className="mr-section-actions">
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

              <DataGrid
                columns={columns}
                rows={visibleRows}
                canEdit={canImportExport && activeTab === "week-detail"}
                editableColumns={
                  activeTab === "week-detail" ? WEEKLY_EDITABLE_COLUMNS : undefined
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
                onCellCommit={(rowIndex, column, value) => {
                  void handleWeekDetailCellCommit(rowIndex, column, value);
                }}
              />
            </>
          )}
        </div>
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
        defaultWeek={week}
        lockedTabId={pendingUploadTab}
        onCancel={() => {
          setPendingWorkbook(null);
          setPendingUploadTab(null);
        }}
        onConfirm={(targetWeek, selectedSheets) => {
          void handleWeeklyImport(targetWeek, selectedSheets);
        }}
      />
    </div>
  );
}
