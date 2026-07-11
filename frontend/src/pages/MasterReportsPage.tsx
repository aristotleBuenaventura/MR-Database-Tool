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
import { importAllSourceSheets, previousWeekCode } from "../lib/weeklyImport";

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

function filterRows(
  rows: string[][],
  columns: string[],
  filters: Record<string, string>,
  filterFields: { id: string; label: string }[],
): string[][] {
  const activeFilters = filterFields
    .map((field) => ({
      columnIndex: columns.findIndex(
        (column) => column.toLowerCase() === field.label.toLowerCase(),
      ),
      value: (filters[field.id] ?? "").trim().toLowerCase(),
    }))
    .filter((item) => item.columnIndex >= 0 && item.value);

  if (activeFilters.length === 0) return rows;

  return rows.filter((row) =>
    activeFilters.every(({ columnIndex, value }) =>
      String(row[columnIndex] ?? "")
        .toLowerCase()
        .includes(value),
    ),
  );
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
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [uploadName, setUploadName] = useState("");
  const [tableRows, setTableRows] = useState<string[][]>([]);
  const [pendingWorkbook, setPendingWorkbook] = useState<ParsedWorkbook | null>(null);
  const [readingFile, setReadingFile] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [savingData, setSavingData] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
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
      setTableRows(cached.rows);
      if (activeTab === "week-detail") setUploadName(cached.fileName);
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
        if (activeTab === "week-detail") setUploadName(data.fileName);
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

  async function openWeeklyPicker(file: File) {
    setImportMessage(null);
    setReadingFile(true);
    try {
      const parsed = await parseWorkbookFile(file);
      if (parsed.sheetNames.length === 0) {
        setImportMessage("No sheets found in this file.");
        return;
      }
      setPendingWorkbook(parsed);
      setUploadName(file.name);
    } catch (error) {
      console.error(error);
      setImportMessage("Failed to read Excel file.");
    } finally {
      setReadingFile(false);
    }
  }

  async function handleWeeklyImport(targetWeek: string, selectedSheets: string[]) {
    if (!pendingWorkbook) return;
    setSavingData(true);
    setImportMessage(null);

    try {
      setWeek(targetWeek);
      setWeekOptions((current) =>
        current.includes(targetWeek) ? current : [targetWeek, ...current],
      );
      const imported = importAllSourceSheets(pendingWorkbook, targetWeek, selectedSheets);

      const sources: Partial<Record<ReportTabId, string[][]>> = {};
      for (const tabId of SOURCE_TABS) {
        if (imported[tabId]) {
          sources[tabId] = imported[tabId] ?? [];
          continue;
        }

        const existingKey = cacheKey(market.id, targetWeek, tabId);
        const cached = getCachedReport(existingKey);
        if (cached) {
          sources[tabId] = cached.rows;
          continue;
        }

        const existing = await api.getReport({
          marketId: market.id,
          week: targetWeek,
          tabId,
        });
        sources[tabId] = existing.dataset?.rows ?? [];
        setCachedReport(existingKey, {
          rows: sources[tabId] ?? [],
          fileName: existing.dataset?.fileName ?? "",
          location: "",
        });
      }

      const prevWeek = previousWeekCode(targetWeek);
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

      const importedWeekRows = imported["week-detail"] ?? [];
      const importedSourceCount = SOURCE_TABS.reduce(
        (count, tabId) => count + (imported[tabId]?.length ?? 0),
        0,
      );

      // Prefer the uploaded week sheet values as-is (commissions, NCF, etc.).
      // Only recompute from sources when the week sheet was not included.
      let weekDetail: string[][];
      if (importedWeekRows.length > 0) {
        weekDetail = normalizeWeekDetailStatuses(importedWeekRows);
      } else if (importedSourceCount > 0) {
        weekDetail = normalizeWeekDetailStatuses(
          computeWeeklyDetail({
            week: targetWeek,
            sources: {
              ...sources,
              "aff-su":
                imported.affSuAll.length > 0 ? imported.affSuAll : sources["aff-su"],
            },
            prevWeekDetail,
          }),
        );
      } else {
        weekDetail = [];
      }

      if (weekDetail.length === 0) {
        throw new Error(
          `No rows imported for ${targetWeek}. Select the week sheet (e.g. ${targetWeek}) and/or source sheets like Aff RawW.`,
        );
      }

      const paidComm = derivePaidComm(targetWeek, weekDetail);
      sources["paid-comm"] = paidComm;

      // Prefer imported Weekly Summary sheet rows (all weeks); otherwise compute KPI for target week.
      const importedKpi = imported["weekly-summary"] ?? [];
      const kpiRows =
        importedKpi.length > 0
          ? importedKpi
          : [
              computeWeeklyKpi({
                week: targetWeek,
                sources,
                paidComm,
              }),
            ];

      const weeklySummaryItems = (() => {
        const byWeek = new Map<
          string,
          {
            tabId: "weekly-summary";
            week: string;
            columns: string[];
            rows: string[][];
            sheetName: string;
          }
        >();
        for (const row of kpiRows) {
          const rowWeek = String(row[0] ?? "")
            .trim()
            .toUpperCase();
          const weekCode = /^\d{4}W\d{2}$/i.test(rowWeek) ? rowWeek : targetWeek;
          byWeek.set(weekCode, {
            tabId: "weekly-summary",
            week: weekCode,
            columns: TAB_COLUMNS["weekly-summary"],
            rows: [row],
            sheetName: "Weekly Summary",
          });
        }
        return [...byWeek.values()];
      })();

      const importedSourceTabs = new Set(
        imported.detectedSheets
          .map((item) => item.tabId)
          .filter((tabId) => tabId !== "week-detail" && tabId !== "weekly-summary"),
      );

      const items = [
        ...SOURCE_TABS.filter(
          (tabId) => tabId !== "paid-comm" && importedSourceTabs.has(tabId),
        ).map((tabId) => ({
          tabId,
          columns: TAB_COLUMNS[tabId as Exclude<ReportTabId, "database">],
          rows: sources[tabId] ?? [],
          sheetName: imported.detectedSheets.find((d) => d.tabId === tabId)?.sheetName ?? null,
        })),
        {
          tabId: "paid-comm" as const,
          columns: TAB_COLUMNS["paid-comm"],
          rows: paidComm,
          sheetName: "derived-from-week-detail",
        },
        {
          tabId: "week-detail" as const,
          columns: TAB_COLUMNS["week-detail"],
          rows: weekDetail,
          sheetName: targetWeek,
        },
        ...weeklySummaryItems,
      ];

      await api.saveReportsBulk({
        marketId: market.id,
        week: targetWeek,
        fileName: pendingWorkbook.fileName,
        items,
      });

      for (const item of items) {
        const itemWeek = "week" in item && item.week ? String(item.week) : targetWeek;
        setCachedReport(cacheKey(market.id, itemWeek, item.tabId), {
          rows: item.rows,
          fileName: pendingWorkbook.fileName,
          location: "",
        });
      }

      // Keep all-weeks Weekly Summary cache in sync (not filtered by selected week).
      const summaryKey = cacheKey(market.id, WEEKLY_SUMMARY_CACHE_WEEK, "weekly-summary");
      const existingSummary = getCachedReport(summaryKey);
      const mergedSummary = upsertWeeklySummaryRows(
        existingSummary?.rows ?? [],
        kpiRows,
      );
      setCachedReport(summaryKey, {
        rows: mergedSummary,
        fileName: pendingWorkbook.fileName,
        location: "",
      });

      const summaryWeeks = weeklySummaryItems.map((item) => item.week);
      setWeekOptions((current) => {
        const next = [...current];
        for (const code of summaryWeeks) {
          if (!next.includes(code)) next.unshift(code);
        }
        return next;
      });

      setActiveTab("week-detail");
      setTableRows(weekDetail);
      setPendingWorkbook(null);

      setImportMessage(
        `Imported ${targetWeek} from sheets: ${selectedSheets.join(", ")}. Week tab rows: ${weekDetail.length}. Weekly Summary weeks: ${mergedSummary.length}.`,
      );
    } catch (error) {
      console.error(error);
      setImportMessage(error instanceof Error ? error.message : "Failed to import weekly workbook");
    } finally {
      setSavingData(false);
    }
  }

  function handleLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  async function handleWeekDetailCellCommit(rowIndex: number, column: string, value: string) {
    if (activeTab !== "week-detail" || !canImportExport) return;

    const colIndex = columns.indexOf(column);
    if (colIndex < 0) return;

    const visibleRow = visibleRows[rowIndex];
    const actualIndex =
      visibleRow != null ? tableRows.indexOf(visibleRow) : rowIndex;
    if (actualIndex < 0) return;

    const current = tableRows[actualIndex];
    if (!current) return;

    const draft = [...current];
    draft[colIndex] = column === "Status" ? (value === "Paid" ? "Paid" : "Unpaid") : value;
    const recalculated =
      column === "Status" ? draft : recalculateWeeklyDetailRow(draft);

    const nextRows = tableRows.map((row, index) =>
      index === actualIndex ? recalculated : row,
    );
    setTableRows(nextRows);

    const paidComm = derivePaidComm(week, nextRows);

    // Refresh Weekly Summary commission fields from Paid Comm (all-weeks table).
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
        updated[commissionIndex] = String(Number(commission.toFixed(6)));
        const net = Number(String(updated[netIndex] ?? "").replace(/,/g, "") || 0);
        if (ratioIndex >= 0) {
          updated[ratioIndex] =
            net > 0 || net === 0 ? "0" : String(Number((commission / net).toFixed(6)));
        }
      }
      nextKpiRows = [updated];
    }

    try {
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
      setImportMessage(`Updated ${column} for row ${actualIndex + 1} and recalculated formulas.`);
    } catch (error) {
      console.error(error);
      setImportMessage(error instanceof Error ? error.message : "Failed to save edit");
    }
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
            <p className="mr-import-message">Importing workbook and calculating formulas...</p>
          ) : null}
          {importMessage ? <p className="mr-import-message">{importMessage}</p> : null}

          {activeTab === "database" ? (
            <section className="panel">
              <h2>DATABASE</h2>
              <p className="lede">
                Raw source tables are filled automatically from the weekly workbook upload on the
                week tab (e.g. {week}). Use that tab to import Aff Raw, Player Raw, System Comm, Aff
                SU, and Business Raw in one go.
              </p>
            </section>
          ) : (
            <>
              <div className="mr-toolbar">
                {activeTab === "week-detail" ? (
                  <UploadPanel
                    title="WEEKLY WORKBOOK UPLOAD"
                    canUpload={canImportExport}
                    fileName={uploadName}
                    busy={readingFile || savingData}
                    onPickFile={(file) => void openWeeklyPicker(file)}
                  />
                ) : (
                  <section className="mr-upload">
                    <h2>{activeLabel.toUpperCase()}</h2>
                    <p className="mr-readonly-note">
                      {activeTab === "weekly-summary"
                        ? "Guideline WEEKLY SUMMARY TAB — all imported weeks (not filtered by the week dropdown)."
                        : "Auto-filled from weekly workbook upload. No separate upload on this tab."}
                    </p>
                  </section>
                )}

                {filterFields.length > 0 ? (
                  <AffiliateFilter
                    fields={filterFields}
                    values={filters}
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
                  }${tableRows.length ? ` · ${visibleRows.length} rows` : ""}`}
                </span>
                <ExportButton canExport={canImportExport} />
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
                onCellCommit={(rowIndex, column, value) => {
                  void handleWeekDetailCellCommit(rowIndex, column, value);
                }}
              />
            </>
          )}
        </div>
      </div>

      <WeeklyImportModal
        open={Boolean(pendingWorkbook)}
        workbook={pendingWorkbook}
        defaultWeek={week}
        onCancel={() => setPendingWorkbook(null)}
        onConfirm={(targetWeek, selectedSheets) => {
          void handleWeeklyImport(targetWeek, selectedSheets);
        }}
      />
    </div>
  );
}
