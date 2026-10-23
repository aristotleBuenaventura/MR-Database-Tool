import { useEffect, useId, useMemo, useRef, useState } from "react";
import { api } from "../../api/client";
import {
  TAB_COLUMNS,
  isPromoWeeklyMarket,
  periodCopy,
  reportTabsForMarket,
  userErrorMessage,
  type ReportTabId,
} from "../../config/reports";
import JSZip from "jszip";
import {
  downloadBlob,
  exportTableCsv,
  rowsToCsv,
  slugFilenamePart,
} from "../../lib/exportCsv";
import type { CommissionSettings } from "../../lib/commissionSettings";
import { CommissionSettingsCard } from "./CommissionSettingsCard";

type Props = {
  marketId: string;
  marketLabel: string;
  canDelete: boolean;
  canUpload: boolean;
  canExport: boolean;
  rawUploadBusy?: boolean;
  baseWeekDetailBusy?: boolean;
  baseWeeklySummaryBusy?: boolean;
  onPickFile: (file: File) => void;
  /** Upload a Week Detail Excel as carry-over base (week auto-detected from file). */
  onPickBaseWeekDetail: (file: File) => void;
  /** Upload historical Weekly Summary rows as Total Aff carry-over seed. */
  onPickBaseWeeklySummary: (file: File) => void;
  onDeleted: () => void;
  commissionSettings: CommissionSettings | null;
  onCommissionSettingsSaved: (settings: CommissionSettings) => void;
};

/** Only raw upload sources can be deleted directly. */
const RAW_UPLOAD_TAB_IDS: ReportTabId[] = [
  "aff-raw-upload",
  "player-raw-upload",
  "system-comm-raw",
  "aff-su",
  "business-raw",
];

function deletableTabsForMarket(marketId: string) {
  return reportTabsForMarket(marketId).filter((tab) =>
    RAW_UPLOAD_TAB_IDS.includes(tab.id),
  );
}

type ExportTableId = Exclude<ReportTabId, "history" | "database">;

function exportableTabsForMarket(marketId: string) {
  return reportTabsForMarket(marketId).filter(
    (tab): tab is { id: ExportTableId; label: string } =>
      tab.id !== "history" && tab.id !== "database",
  );
}

const ALL_TABLES = "__all__";
type TableChoice = ReportTabId | typeof ALL_TABLES;

type PendingDelete = {
  week: string;
  table: TableChoice;
  tableLabel: string;
};

export function DatabasePanel({
  marketId,
  marketLabel,
  canDelete,
  canUpload,
  canExport,
  rawUploadBusy = false,
  baseWeekDetailBusy = false,
  baseWeeklySummaryBusy = false,
  onPickFile,
  onPickBaseWeekDetail,
  onPickBaseWeeklySummary,
  onDeleted,
  commissionSettings,
  onCommissionSettingsSaved,
}: Props) {
  const rawInputRef = useRef<HTMLInputElement>(null);
  const baseInputRef = useRef<HTMLInputElement>(null);
  const baseSummaryInputRef = useRef<HTMLInputElement>(null);
  const rawInputId = useId();
  const baseInputId = useId();
  const baseSummaryInputId = useId();
  const [weeks, setWeeks] = useState<string[]>([]);
  const [loadingWeeks, setLoadingWeeks] = useState(false);
  const [selectedWeek, setSelectedWeek] = useState<string>("");
  const [selectedTable, setSelectedTable] = useState<TableChoice>(ALL_TABLES);
  const [exportWeek, setExportWeek] = useState<string>("");
  const [exportTable, setExportTable] = useState<TableChoice>(ALL_TABLES);
  const [exporting, setExporting] = useState(false);

  const [pending, setPending] = useState<PendingDelete | null>(null);
  const [password, setPassword] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const isPromo = isPromoWeeklyMarket(marketId);
  const words = periodCopy(marketId);
  const deletableTabs = useMemo(
    () => deletableTabsForMarket(marketId),
    [marketId],
  );
  const exportableTabs = useMemo(
    () => exportableTabsForMarket(marketId),
    [marketId],
  );

  useEffect(() => {
    let cancelled = false;
    setLoadingWeeks(true);
    setWeeks([]);
    setSelectedWeek("");
    setExportWeek("");
    setMessage(null);
    setError(null);
    api
      .getWeeks({ marketId })
      .then((result) => {
        if (cancelled) return;
        setWeeks(result.weeks);
        const fallback = result.weeks[0] ?? "";
        setSelectedWeek((current) =>
          current && result.weeks.includes(current) ? current : fallback,
        );
        setExportWeek((current) =>
          current && result.weeks.includes(current) ? current : fallback,
        );
      })
      .catch((err) => {
        if (cancelled) return;
        setError(userErrorMessage(err, `Failed to load ${words.weeks}`, marketId));
      })
      .finally(() => {
        if (!cancelled) setLoadingWeeks(false);
      });
    return () => {
      cancelled = true;
    };
  }, [marketId, words.weeks]);

  const selectedTableLabel = useMemo(() => {
    if (selectedTable === ALL_TABLES) return "All raw tables";
    return (
      deletableTabs.find((tab) => tab.id === selectedTable)?.label ??
      selectedTable
    );
  }, [selectedTable, deletableTabs]);

  const selectedExportTableLabel = useMemo(() => {
    if (exportTable === ALL_TABLES) return "All tables";
    return (
      exportableTabs.find((tab) => tab.id === exportTable)?.label ??
      exportTable
    );
  }, [exportTable, exportableTabs]);

  async function handleExport() {
    if (!canExport || !exportWeek || exporting) return;
    setExporting(true);
    setError(null);
    setMessage(null);
    try {
      // Single table → one CSV download.
      if (exportTable !== ALL_TABLES) {
        const tabId = exportTable as ExportTableId;
        const res = await api.getReport({ marketId, week: exportWeek, tabId });
        const rows = res.dataset?.rows ?? [];
        if (rows.length === 0) {
          setMessage(`No data to export for ${exportWeek}.`);
          return;
        }
        const columns =
          res.dataset?.columns && res.dataset.columns.length > 0
            ? res.dataset.columns
            : TAB_COLUMNS[tabId];
        exportTableCsv({
          columns,
          rows,
          filenameParts: [marketLabel, exportWeek, tabId],
        });
        setMessage(`Exported ${selectedExportTableLabel} for ${exportWeek}.`);
        return;
      }

      // All tables → bundle every CSV into a single ZIP.
      const zip = new JSZip();
      let files = 0;
      let empty = 0;
      for (const tab of exportableTabs) {
        const res = await api.getReport({
          marketId,
          week: exportWeek,
          tabId: tab.id,
        });
        const rows = res.dataset?.rows ?? [];
        if (rows.length === 0) {
          empty += 1;
          continue;
        }
        const columns =
          res.dataset?.columns && res.dataset.columns.length > 0
            ? res.dataset.columns
            : TAB_COLUMNS[tab.id];
        const csv = rowsToCsv(columns, rows);
        zip.file(`${slugFilenamePart(tab.label)}.csv`, `\uFEFF${csv}`);
        files += 1;
      }

      if (files === 0) {
        setMessage(`No data to export for ${exportWeek}.`);
        return;
      }

      const blob = await zip.generateAsync({
        type: "blob",
        compression: "DEFLATE",
        compressionOptions: { level: 6 },
      });
      const zipName = `${[marketLabel, exportWeek]
        .map(slugFilenamePart)
        .join("_")}_all-tables.zip`;
      downloadBlob(zipName, blob);
      setMessage(
        `Exported ${files} table(s) to ${zipName}${
          empty > 0 ? ` (${empty} empty table(s) skipped)` : ""
        }.`,
      );
    } catch (err) {
      setError(userErrorMessage(err, "Failed to export data", marketId));
    } finally {
      setExporting(false);
    }
  }

  function openDelete() {
    if (!canDelete || !selectedWeek) return;
    setPending({
      week: selectedWeek,
      table: selectedTable,
      tableLabel: selectedTableLabel,
    });
    setPassword("");
    setError(null);
  }

  function closeModal() {
    if (deleting) return;
    setPending(null);
    setPassword("");
    setError(null);
  }

  async function confirmDelete() {
    if (!pending || !password.trim()) return;
    setDeleting(true);
    setError(null);
    try {
      const isAll = pending.table === ALL_TABLES;
      const result = await api.purgeReports({
        marketId,
        scope: isAll ? "week" : "tab",
        tabId: isAll ? undefined : (pending.table as ReportTabId),
        week: pending.week,
        password,
      });
      const target = isAll
        ? `all raw uploads for ${pending.week}`
        : `"${pending.tableLabel}" for ${pending.week}`;
      setMessage(
        result.deleted > 0
          ? `Deleted ${result.deleted} dataset(s) — ${target}. A snapshot was saved to History and can be restored.`
          : `No saved data found for ${target}.`,
      );
      setPending(null);
      setPassword("");
      // Refresh the weeks list (a week may now be empty).
      try {
        const refreshed = await api.getWeeks({ marketId });
        setWeeks(refreshed.weeks);
        const fallback = refreshed.weeks[0] ?? "";
        setSelectedWeek((current) =>
          current && refreshed.weeks.includes(current) ? current : fallback,
        );
      } catch {
        // ignore refresh errors
      }
      onDeleted();
    } catch (err) {
      setError(userErrorMessage(err, "Failed to delete data", marketId));
    } finally {
      setDeleting(false);
    }
  }

  const noWeeks = weeks.length === 0;

  return (
    <section className="mr-database panel">
      <header className="mr-database-header">
        <div>
          <h2>
            {canUpload || canExport || canDelete
              ? "DATABASE · UPLOAD, EXPORT, & DELETE"
              : "DATABASE"}
          </h2>
          <p className="mr-readonly-note">
            {canUpload || canExport || canDelete
              ? `Upload, export, or delete ${marketLabel}'s data. Deleting a raw source also clears its linked tables for that ${words.week}. Deletions need your password and are saved to History.`
              : `${marketLabel} database tools require admin access.`}
          </p>
        </div>
      </header>

      {message ? <p className="mr-import-message">{message}</p> : null}
      {!pending && error ? (
        <p className="mr-import-message mr-history-error">{error}</p>
      ) : null}

      <div className="mr-database-sections">
        {canUpload ? (
          <section className="mr-database-section" aria-labelledby="db-upload-heading">
            <h3 id="db-upload-heading" className="mr-database-section-title">
              Upload
            </h3>
            <div className="mr-database-upload-layout">
              <article className="mr-database-card mr-database-card-primary">
                <div className="mr-database-card-head">
                  <div className="mr-database-card-icon" aria-hidden>
                    ⬆
                  </div>
                  <h3>Upload data</h3>
                </div>
                <p className="mr-database-card-desc">
                  One Excel file imports every recognized raw sheet. {words.Weekly} tables
                  recompute after you confirm the sheets.
                </p>
                <div className="mr-database-card-actions">
                  <button
                    type="button"
                    className={`mr-file-btn mr-database-upload-btn ${
                      rawUploadBusy ? "disabled" : ""
                    }`}
                    disabled={rawUploadBusy || baseWeekDetailBusy || baseWeeklySummaryBusy}
                    onClick={() => rawInputRef.current?.click()}
                  >
                    {rawUploadBusy ? "Reading…" : "Choose Excel file"}
                  </button>
                </div>
                <input
                  id={rawInputId}
                  ref={rawInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  hidden
                  disabled={rawUploadBusy || baseWeekDetailBusy || baseWeeklySummaryBusy}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) onPickFile(file);
                  }}
                />
              </article>

              <div className="mr-database-base-grid">
                <article className="mr-database-card mr-database-card-base">
                  <div className="mr-database-card-head">
                    <div className="mr-database-card-icon" aria-hidden>
                      ⧉
                    </div>
                    <h3>Base {words.detail}</h3>
                  </div>
                  <p className="mr-database-card-desc">
                    Carry-over seed for {words.ncf}. {words.Week} auto-detected from
                    the file.
                  </p>
                  <div className="mr-database-card-actions">
                    <button
                      type="button"
                      className={`mr-file-btn mr-database-upload-btn ${
                        baseWeekDetailBusy ? "disabled" : ""
                      }`}
                      disabled={
                        baseWeekDetailBusy ||
                        baseWeeklySummaryBusy ||
                        rawUploadBusy
                      }
                      onClick={() => baseInputRef.current?.click()}
                    >
                      {baseWeekDetailBusy ? "Saving…" : "Choose file"}
                    </button>
                  </div>
                  <input
                    id={baseInputId}
                    ref={baseInputRef}
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    hidden
                    disabled={
                      baseWeekDetailBusy ||
                      baseWeeklySummaryBusy ||
                      rawUploadBusy
                    }
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (!file) return;
                      setError(null);
                      setMessage(null);
                      onPickBaseWeekDetail(file);
                    }}
                  />
                </article>

                {isPromo ? null : (
                <article className="mr-database-card mr-database-card-base">
                  <div className="mr-database-card-head">
                    <div className="mr-database-card-icon" aria-hidden>
                      ⧉
                    </div>
                    <h3>Base {words.summary}</h3>
                  </div>
                  <p className="mr-database-card-desc">
                    Historical Total Aff seed. Later {words.weeks} carry forward from
                    the latest base {words.week}.
                  </p>
                  <div className="mr-database-card-actions">
                    <button
                      type="button"
                      className={`mr-file-btn mr-database-upload-btn ${
                        baseWeeklySummaryBusy ? "disabled" : ""
                      }`}
                      disabled={
                        baseWeekDetailBusy ||
                        baseWeeklySummaryBusy ||
                        rawUploadBusy
                      }
                      onClick={() => baseSummaryInputRef.current?.click()}
                    >
                      {baseWeeklySummaryBusy ? "Saving…" : "Choose file"}
                    </button>
                  </div>
                  <input
                    id={baseSummaryInputId}
                    ref={baseSummaryInputRef}
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    hidden
                    disabled={
                      baseWeekDetailBusy ||
                      baseWeeklySummaryBusy ||
                      rawUploadBusy
                    }
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (!file) return;
                      setError(null);
                      setMessage(null);
                      onPickBaseWeeklySummary(file);
                    }}
                  />
                </article>
                )}
              </div>
            </div>
          </section>
        ) : null}

        {canUpload ? (
          <CommissionSettingsCard
            marketId={marketId}
            marketLabel={marketLabel}
            weeks={weeks}
            settings={commissionSettings}
            onSaved={onCommissionSettingsSaved}
          />
        ) : null}

        {canExport || canDelete ? (
          <section
            className="mr-database-section"
            aria-labelledby="db-manage-heading"
          >
            <h3 id="db-manage-heading" className="mr-database-section-title">
              Manage data
            </h3>
            <div className="mr-database-manage-grid">
        {canExport ? (
          <article className="mr-database-card">
            <div className="mr-database-card-head">
              <div className="mr-database-card-icon" aria-hidden>
                ⬇
              </div>
              <h3>Export CSV</h3>
            </div>
            <p className="mr-database-card-desc">
              Export one table as CSV, or all tables for a {words.week} as a ZIP.
            </p>
            <div className="mr-database-card-fields">
            <label className="mr-database-field">
              <span>{words.Week}</span>
              <select
                value={exportWeek}
                onChange={(event) => setExportWeek(event.target.value)}
                disabled={loadingWeeks || noWeeks}
              >
                {noWeeks ? (
                  <option value="">
                    {loadingWeeks ? "Loading…" : `No ${words.weeks}`}
                  </option>
                ) : (
                  weeks.map((week) => (
                    <option key={week} value={week}>
                      {week}
                    </option>
                  ))
                )}
              </select>
            </label>
            <label className="mr-database-field">
              <span>Table</span>
              <select
                value={exportTable}
                onChange={(event) =>
                  setExportTable(event.target.value as TableChoice)
                }
              >
                <option value={ALL_TABLES}>All tables</option>
                {exportableTabs.map((tab) => (
                  <option key={tab.id} value={tab.id}>
                    {tab.label}
                  </option>
                ))}
              </select>
            </label>
            </div>
            <div className="mr-database-card-actions">
            <button
              type="button"
              className="mr-btn-primary"
              onClick={() => void handleExport()}
              disabled={!exportWeek || exporting}
            >
              {exporting ? "Exporting…" : "Export CSV"}
            </button>
            </div>
          </article>
        ) : null}

        {!canDelete ? (
          canExport ? null : (
          <p className="mr-no-data mr-database-permission-note">
            You do not have permission to upload, export, or delete data. Admin
            access is required.
          </p>
          )
        ) : (
          <article className="mr-database-card mr-database-card-danger">
            <div className="mr-database-card-head">
              <div className="mr-database-card-icon" aria-hidden>
                ▦
              </div>
              <h3>Delete data</h3>
            </div>
            <p className="mr-database-card-desc">
              Delete one raw table or all raw uploads for a {words.week}. Linked tables
              clear automatically.
            </p>
            <div className="mr-database-card-fields">
            <label className="mr-database-field">
              <span>{words.Week}</span>
              <select
                value={selectedWeek}
                onChange={(event) => setSelectedWeek(event.target.value)}
                disabled={loadingWeeks || noWeeks}
              >
                {noWeeks ? (
                  <option value="">
                    {loadingWeeks ? "Loading…" : `No ${words.weeks}`}
                  </option>
                ) : (
                  weeks.map((week) => (
                    <option key={week} value={week}>
                      {week}
                    </option>
                  ))
                )}
              </select>
            </label>
            <label className="mr-database-field">
              <span>Table</span>
              <select
                value={selectedTable}
                onChange={(event) =>
                  setSelectedTable(event.target.value as TableChoice)
                }
              >
                <option value={ALL_TABLES}>All raw tables</option>
                {deletableTabs.map((tab) => (
                  <option key={tab.id} value={tab.id}>
                    {tab.label}
                  </option>
                ))}
              </select>
            </label>
            </div>
            <div className="mr-database-card-actions">
            <button
              type="button"
              className="mr-btn-primary mr-database-delete-btn"
              onClick={openDelete}
              disabled={!selectedWeek}
            >
              Delete data
            </button>
            </div>
          </article>
        )}
            </div>
          </section>
        ) : !canUpload ? (
          <p className="mr-no-data mr-database-permission-note">
            {canExport
              ? "You do not have permission to delete data. Admin access is required."
              : "You do not have permission to upload, export, or delete data. Admin access is required."}
          </p>
        ) : null}
      </div>

      {pending ? (
        <div
          className="mr-modal-backdrop"
          role="presentation"
          onClick={closeModal}
        >
          <div
            className="mr-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="db-delete-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="mr-modal-header">
              <div>
                <h2 id="db-delete-title">Confirm deletion</h2>
              </div>
              <button
                type="button"
                className="mr-modal-close"
                onClick={closeModal}
                aria-label="Close"
              >
                ×
              </button>
            </header>
            <div className="mr-modal-body">
              <p className="mr-modal-hint">
                You are about to permanently delete{" "}
                {pending.table === ALL_TABLES ? (
                  <>
                    <strong>all raw uploads</strong> for {words.week}{" "}
                    <strong>{pending.week}</strong>
                  </>
                ) : (
                  <>
                    the raw table <strong>{pending.tableLabel}</strong> for {words.week}{" "}
                    <strong>{pending.week}</strong>
                  </>
                )}{" "}
                in {marketLabel}. The linked tables ({words.detail}, {words.summary},
                Paid Comm, Bad Aff, Adjustment Notes) for that {words.week} will also be
                cleared. Enter your password to confirm.
              </p>
              <label className="mr-database-field">
                <span>Password</span>
                <input
                  type="password"
                  value={password}
                  autoFocus
                  autoComplete="current-password"
                  placeholder="Your account password"
                  onChange={(event) => setPassword(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && password.trim() && !deleting) {
                      void confirmDelete();
                    }
                  }}
                />
              </label>
              {error ? (
                <p className="mr-import-message mr-history-error">{error}</p>
              ) : null}
            </div>
            <footer className="mr-modal-footer">
              <button
                type="button"
                className="mr-btn-secondary"
                onClick={closeModal}
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="mr-btn-primary"
                onClick={() => void confirmDelete()}
                disabled={deleting || !password.trim()}
              >
                {deleting ? "Deleting…" : "Delete permanently"}
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </section>
  );
}
