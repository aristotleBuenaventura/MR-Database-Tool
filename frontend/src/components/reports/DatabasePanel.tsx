import { useEffect, useId, useMemo, useRef, useState } from "react";
import { api } from "../../api/client";
import {
  REPORT_TABS,
  TAB_COLUMNS,
  type ReportTabId,
} from "../../config/reports";
import JSZip from "jszip";
import {
  downloadBlob,
  exportTableCsv,
  rowsToCsv,
  slugFilenamePart,
} from "../../lib/exportCsv";

type Props = {
  marketId: string;
  marketLabel: string;
  canDelete: boolean;
  canUpload: boolean;
  canExport: boolean;
  rawUploadBusy?: boolean;
  baseUploadBusy?: boolean;
  onPickFile: (file: File) => void;
  /** Upload a Week Detail Excel as carry-over base (week auto-detected from file). */
  onPickBaseWeekDetail: (file: File) => void;
  onDeleted: () => void;
};

/** Only raw upload sources can be deleted directly. */
const RAW_UPLOAD_TAB_IDS: ReportTabId[] = [
  "aff-raw-upload",
  "player-raw-upload",
  "system-comm-raw",
  "aff-su",
  "business-raw",
];

const DELETABLE_TABS = REPORT_TABS.filter((tab) =>
  RAW_UPLOAD_TAB_IDS.includes(tab.id),
);

type ExportTableId = Exclude<ReportTabId, "history" | "database">;

/** Every data tab can be exported (raw + derived), except the tool tabs. */
const EXPORTABLE_TABS = REPORT_TABS.filter(
  (tab): tab is { id: ExportTableId; label: string } =>
    tab.id !== "history" && tab.id !== "database",
);

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
  baseUploadBusy = false,
  onPickFile,
  onPickBaseWeekDetail,
  onDeleted,
}: Props) {
  const rawInputRef = useRef<HTMLInputElement>(null);
  const baseInputRef = useRef<HTMLInputElement>(null);
  const rawInputId = useId();
  const baseInputId = useId();
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

  useEffect(() => {
    let cancelled = false;
    setLoadingWeeks(true);
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
        setError(err instanceof Error ? err.message : "Failed to load weeks");
      })
      .finally(() => {
        if (!cancelled) setLoadingWeeks(false);
      });
    return () => {
      cancelled = true;
    };
  }, [marketId]);

  const selectedTableLabel = useMemo(() => {
    if (selectedTable === ALL_TABLES) return "All raw tables";
    return (
      DELETABLE_TABS.find((tab) => tab.id === selectedTable)?.label ??
      selectedTable
    );
  }, [selectedTable]);

  const selectedExportTableLabel = useMemo(() => {
    if (exportTable === ALL_TABLES) return "All tables";
    return (
      EXPORTABLE_TABS.find((tab) => tab.id === exportTable)?.label ??
      exportTable
    );
  }, [exportTable]);

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
      for (const tab of EXPORTABLE_TABS) {
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
      setError(err instanceof Error ? err.message : "Failed to export data");
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
      setError(err instanceof Error ? err.message : "Failed to delete data");
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
              ? `Upload, export, or delete ${marketLabel}'s data. Deleting a raw source also clears its linked tables for that week. Deletions need your password and are saved to History.`
              : `${marketLabel} database tools require admin access.`}
          </p>
        </div>
      </header>

      {message ? <p className="mr-import-message">{message}</p> : null}
      {!pending && error ? (
        <p className="mr-import-message mr-history-error">{error}</p>
      ) : null}

      <div className="mr-database-grid">
        {canUpload ? (
          <article className="mr-database-card">
            <div className="mr-database-card-head">
              <div className="mr-database-card-icon" aria-hidden>
                ⬆
              </div>
              <h3>Upload data</h3>
            </div>
            <p className="mr-database-card-desc">
              One Excel file imports every recognized raw sheet at once. Review
              and confirm next; weekly tables recompute automatically.
            </p>
            <button
              type="button"
              className={`mr-file-btn mr-database-upload-btn ${
                rawUploadBusy ? "disabled" : ""
              }`}
              disabled={rawUploadBusy || baseUploadBusy}
              onClick={() => rawInputRef.current?.click()}
            >
              {rawUploadBusy ? "Reading…" : "Choose Excel file"}
            </button>
            <input
              id={rawInputId}
              ref={rawInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              hidden
              disabled={rawUploadBusy || baseUploadBusy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) onPickFile(file);
              }}
            />
          </article>
        ) : null}

        {canUpload ? (
          <article className="mr-database-card">
            <div className="mr-database-card-head">
              <div className="mr-database-card-icon" aria-hidden>
                ⧉
              </div>
              <h3>Upload base Week Detail</h3>
            </div>
            <p className="mr-database-card-desc">
              Loads Week Detail values exactly from the Excel (not from raw
              files, no formulas). Week is detected from the sheet name or Week
              column. Next week&apos;s Last Week NCF uses this file&apos;s Next
              Week NCF.
            </p>
            <button
              type="button"
              className={`mr-file-btn mr-database-upload-btn ${
                baseUploadBusy ? "disabled" : ""
              }`}
              disabled={baseUploadBusy || rawUploadBusy}
              onClick={() => baseInputRef.current?.click()}
            >
              {baseUploadBusy ? "Saving…" : "Choose Week Detail file"}
            </button>
            <input
              id={baseInputId}
              ref={baseInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              hidden
              disabled={baseUploadBusy || rawUploadBusy}
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
        ) : null}

        {canExport ? (
          <article className="mr-database-card">
            <div className="mr-database-card-head">
              <div className="mr-database-card-icon" aria-hidden>
                ⬇
              </div>
              <h3>Export CSV</h3>
            </div>
            <p className="mr-database-card-desc">
              Export one table as CSV, or all tables for a week bundled into one
              ZIP file.
            </p>
            <label className="mr-database-field">
              <span>Week</span>
              <select
                value={exportWeek}
                onChange={(event) => setExportWeek(event.target.value)}
                disabled={loadingWeeks || noWeeks}
              >
                {noWeeks ? (
                  <option value="">
                    {loadingWeeks ? "Loading…" : "No weeks"}
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
                {EXPORTABLE_TABS.map((tab) => (
                  <option key={tab.id} value={tab.id}>
                    {tab.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="mr-btn-primary"
              onClick={() => void handleExport()}
              disabled={!exportWeek || exporting}
            >
              {exporting ? "Exporting…" : "Export CSV"}
            </button>
          </article>
        ) : null}

        {!canDelete ? (
          <p className="mr-no-data">
            {canExport
              ? "You do not have permission to delete data. Admin access is required."
              : "You do not have permission to upload, export, or delete data. Admin access is required."}
          </p>
        ) : (
          <article className="mr-database-card">
            <div className="mr-database-card-head">
              <div className="mr-database-card-icon" aria-hidden>
                ▦
              </div>
              <h3>Delete data</h3>
            </div>
            <p className="mr-database-card-desc">
              Delete one raw table or every raw upload for a week. Linked tables
              clear automatically.
            </p>
            <label className="mr-database-field">
              <span>Week</span>
              <select
                value={selectedWeek}
                onChange={(event) => setSelectedWeek(event.target.value)}
                disabled={loadingWeeks || noWeeks}
              >
                {noWeeks ? (
                  <option value="">
                    {loadingWeeks ? "Loading…" : "No weeks"}
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
                {DELETABLE_TABS.map((tab) => (
                  <option key={tab.id} value={tab.id}>
                    {tab.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="mr-btn-primary"
              onClick={openDelete}
              disabled={!selectedWeek}
            >
              Delete data
            </button>
          </article>
        )}
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
                    <strong>all raw uploads</strong> for week{" "}
                    <strong>{pending.week}</strong>
                  </>
                ) : (
                  <>
                    the raw table <strong>{pending.tableLabel}</strong> for week{" "}
                    <strong>{pending.week}</strong>
                  </>
                )}{" "}
                in {marketLabel}. The linked tables (Week Detail, Weekly Summary,
                Paid Comm, Bad Aff) for that week will also be cleared. Enter your
                password to confirm.
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
