import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import {
  DATABASE_CATEGORIES,
  REPORT_TABS,
  TAB_COLUMNS,
  WEEKLY_MARKETS,
  type Market,
  type ReportTabId,
} from "../config/reports";
import { AffiliateFilter } from "../components/reports/AffiliateFilter";
import { DataGrid } from "../components/reports/DataGrid";
import { DatabaseTab } from "../components/reports/DatabaseTab";
import { ExportButton } from "../components/reports/ExportButton";
import { ReportsSidebar } from "../components/reports/ReportsSidebar";
import { ReportsTopBar } from "../components/reports/ReportsTopBar";
import { SheetPickerModal } from "../components/reports/SheetPickerModal";
import { UploadPanel } from "../components/reports/UploadPanel";
import { mapSheetToColumns, parseWorkbookFile, type ParsedWorkbook } from "../lib/excel";
import {
  cacheKey,
  getCachedReport,
  loadCached,
  updateCachedDatabaseCategory,
  updateCachedRows,
} from "../lib/reportCache";

const DB_CATEGORY_OPTIONS = DATABASE_CATEGORIES.map((item) => ({
  id: item.id,
  label: item.label,
}));

const UPLOAD_TABS: ReportTabId[] = [
  "paid-comm",
  "system-comm-raw",
  "aff-raw-upload",
  "player-raw-upload",
  "business-raw",
  "aff-su",
];

const FILTER_PRESETS: Partial<Record<ReportTabId, { id: string; label: string }[]>> = {
  "weekly-summary": [
    { id: "affiliateUsername", label: "Affiliate Username" },
    { id: "uplineAffiliateUsername", label: "Upline Affiliate Username" },
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

const DB_CATEGORY_COLUMNS: Record<string, string[]> = {
  "aff-raw": TAB_COLUMNS["aff-raw-upload"],
  "player-raw": TAB_COLUMNS["player-raw-upload"],
  "system-comm": TAB_COLUMNS["system-comm-raw"],
  "paid-comm": TAB_COLUMNS["paid-comm"],
  "aff-su": TAB_COLUMNS["aff-su"],
};

function guessDbCategory(sheetName: string, location: string): string {
  const haystack = `${sheetName} ${location}`.toLowerCase();
  if (haystack.includes("player")) return "player-raw";
  if (haystack.includes("system")) return "system-comm";
  if (haystack.includes("paid")) return "paid-comm";
  if (haystack.includes("su")) return "aff-su";
  if (haystack.includes("aff")) return "aff-raw";
  return DATABASE_CATEGORIES[0]!.id;
}

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

export function MasterReportsPage() {
  const navigate = useNavigate();
  const { user, capabilities, logout } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [market, setMarket] = useState<Market>(WEEKLY_MARKETS[8]!);
  const [week, setWeek] = useState("2026W26");
  const [activeTab, setActiveTab] = useState<ReportTabId>("weekly-summary");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [uploadName, setUploadName] = useState("");
  const [dbFileName, setDbFileName] = useState("");
  const [dbLocation, setDbLocation] = useState("");
  const [tableRows, setTableRows] = useState<string[][]>([]);
  const [dbCategoryData, setDbCategoryData] = useState<Record<string, string[][]>>({});
  const [pendingWorkbook, setPendingWorkbook] = useState<ParsedWorkbook | null>(null);
  const [pickerTarget, setPickerTarget] = useState<"tab" | "database">("tab");
  const [readingFile, setReadingFile] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [savingData, setSavingData] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const canImportExport = Boolean(capabilities?.canImportExport);
  const tabMeta = REPORT_TABS.find((tab) => tab.id === activeTab);
  const filterFields = FILTER_PRESETS[activeTab] ?? [];
  const columns = activeTab === "database" ? [] : TAB_COLUMNS[activeTab];
  const visibleRows = useMemo(
    () => filterRows(tableRows, columns, filters, filterFields),
    [tableRows, columns, filters, filterFields],
  );

  const sectionTitle = useMemo(() => {
    if (activeTab === "weekly-summary") return "Weekly Summary";
    if (activeTab === "paid-comm") return "PAID COMM";
    if (activeTab === "system-comm-raw") return "SYSTEM COMM";
    if (activeTab === "aff-raw-upload") return "AFF RAW";
    if (activeTab === "player-raw-upload") return "PLAYER RAW";
    if (activeTab === "business-raw") return "BUSINESS RAW";
    if (activeTab === "aff-su") return "AFF SU";
    return tabMeta?.label ?? "";
  }, [activeTab, tabMeta]);

  const pickerLabel =
    pickerTarget === "database"
      ? `DATABASE (${dbLocation || "auto category"})`
      : tabMeta?.label ?? "Current tab";

  useEffect(() => {
    const key = cacheKey(market.id, week, activeTab);
    const cached = getCachedReport(key);

    // Instant UI from memory — no network if already loaded this session.
    if (cached) {
      if (activeTab === "database") {
        setDbCategoryData(cached.categoryRows ?? {});
        setDbFileName(cached.fileName);
        setDbLocation(cached.location);
        setTableRows([]);
      } else {
        setTableRows(cached.rows);
        setUploadName(cached.fileName);
      }
      setLoadingData(false);
      return;
    }

    const requestId = ++requestIdRef.current;
    let cancelled = false;

    async function loadSavedData() {
      setLoadingData(true);

      try {
        if (activeTab === "database") {
          const data = await loadCached(key, async () => {
            const result = await api.getDatabaseReports({
              marketId: market.id,
              week,
            });

            const categoryRows: Record<string, string[][]> = {};
            let latestFile = "";
            let latestLocation = "";

            for (const dataset of result.datasets) {
              categoryRows[dataset.category] = dataset.rows;
              if (dataset.fileName) latestFile = dataset.fileName;
              if (dataset.location) latestLocation = dataset.location;
            }

            return {
              rows: [],
              fileName: latestFile,
              location: latestLocation,
              categoryRows,
            };
          });

          if (cancelled || requestId !== requestIdRef.current) return;
          setDbCategoryData(data.categoryRows ?? {});
          setDbFileName(data.fileName);
          setDbLocation(data.location);
          setTableRows([]);
        } else {
          const data = await loadCached(key, async () => {
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
          setUploadName(data.fileName);
        }
      } catch (error) {
        if (cancelled || requestId !== requestIdRef.current) return;
        console.error(error);
        setImportMessage(
          error instanceof Error ? error.message : "Failed to load saved data",
        );
      } finally {
        if (!cancelled && requestId === requestIdRef.current) {
          setLoadingData(false);
        }
      }
    }

    void loadSavedData();

    return () => {
      cancelled = true;
    };
  }, [activeTab, market.id, week]);

  async function openSheetPicker(file: File, target: "tab" | "database") {
    setImportMessage(null);
    setReadingFile(true);
    try {
      const parsed = await parseWorkbookFile(file);
      if (parsed.sheetNames.length === 0) {
        setImportMessage("No sheets found in this file.");
        return;
      }
      setPickerTarget(target);
      setPendingWorkbook(parsed);
      if (target === "tab") setUploadName(file.name);
      if (target === "database") setDbFileName(file.name);
    } catch (error) {
      console.error(error);
      setImportMessage("Failed to read Excel file.");
    } finally {
      setReadingFile(false);
    }
  }

  async function handleConfirmSheet(sheetName: string, categoryId?: string) {
    if (!pendingWorkbook) return;

    setSavingData(true);
    setImportMessage(null);

    try {
      if (pickerTarget === "database") {
        const resolvedCategory = categoryId || guessDbCategory(sheetName, dbLocation);
        const targetColumns =
          DB_CATEGORY_COLUMNS[resolvedCategory] ?? TAB_COLUMNS["aff-raw-upload"];
        const mapped = mapSheetToColumns(pendingWorkbook.workbook, sheetName, targetColumns);
        const locationValue = dbLocation || `${market.label} / ${sheetName}`;

        await api.saveReport({
          marketId: market.id,
          week,
          tabId: "database",
          category: resolvedCategory,
          columns: targetColumns,
          rows: mapped.rows,
          fileName: pendingWorkbook.fileName,
          sheetName,
          location: locationValue,
        });

        const key = cacheKey(market.id, week, "database");
        updateCachedDatabaseCategory(key, resolvedCategory, mapped.rows, {
          fileName: pendingWorkbook.fileName,
          location: locationValue,
        });

        setDbCategoryData((current) => ({ ...current, [resolvedCategory]: mapped.rows }));
        setDbLocation(locationValue);
        setImportMessage(
          `Saved ${mapped.rows.length} row(s) from "${sheetName}" into ${
            DATABASE_CATEGORIES.find((item) => item.id === resolvedCategory)?.label ??
            resolvedCategory
          }. Matched ${mapped.matchedColumns.length}/${targetColumns.length} columns.`,
        );
      } else if (activeTab !== "database") {
        const targetColumns = TAB_COLUMNS[activeTab];
        const mapped = mapSheetToColumns(pendingWorkbook.workbook, sheetName, targetColumns);

        await api.saveReport({
          marketId: market.id,
          week,
          tabId: activeTab,
          columns: targetColumns,
          rows: mapped.rows,
          fileName: pendingWorkbook.fileName,
          sheetName,
        });

        const key = cacheKey(market.id, week, activeTab);
        updateCachedRows(key, mapped.rows, {
          fileName: pendingWorkbook.fileName,
        });

        setTableRows(mapped.rows);
        setImportMessage(
          `Saved ${mapped.rows.length} row(s) from "${sheetName}" to database. Matched ${mapped.matchedColumns.length}/${targetColumns.length} columns.`,
        );
      }

      setPendingWorkbook(null);
    } catch (error) {
      console.error(error);
      setImportMessage(error instanceof Error ? error.message : "Failed to save data");
    } finally {
      setSavingData(false);
    }
  }

  function handleLogout() {
    logout();
    navigate("/login", { replace: true });
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
          {savingData ? <p className="mr-import-message">Saving to database...</p> : null}
          {importMessage ? <p className="mr-import-message">{importMessage}</p> : null}

          {activeTab === "database" ? (
            <DatabaseTab
              canImportExport={canImportExport}
              fileName={dbFileName}
              location={dbLocation}
              onLocationChange={setDbLocation}
              onPickFile={(file) => void openSheetPicker(file, "database")}
              busy={readingFile || savingData}
              categoryData={dbCategoryData}
            />
          ) : (
            <>
              <div className="mr-toolbar">
                {UPLOAD_TABS.includes(activeTab) ? (
                  <UploadPanel
                    title={`${tabMeta?.label.toUpperCase() ?? "UPLOAD"}`}
                    canUpload={canImportExport}
                    fileName={uploadName}
                    busy={readingFile || savingData}
                    onPickFile={(file) => void openSheetPicker(file, "tab")}
                  />
                ) : null}

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
                  {activeTab === "weekly-summary"
                    ? `${market.label} · ${week}`
                    : `${sectionTitle}${tableRows.length ? ` · ${visibleRows.length} rows` : ""}`}
                </span>
                <ExportButton canExport={canImportExport} />
              </div>

              <DataGrid columns={columns} rows={visibleRows} />
            </>
          )}
        </div>
      </div>

      <SheetPickerModal
        open={Boolean(pendingWorkbook)}
        workbook={pendingWorkbook}
        targetLabel={pickerLabel}
        categories={pickerTarget === "database" ? DB_CATEGORY_OPTIONS : undefined}
        onCancel={() => {
          setPendingWorkbook(null);
        }}
        onConfirm={(sheetName, categoryId) => {
          void handleConfirmSheet(sheetName, categoryId);
        }}
      />
    </div>
  );
}
