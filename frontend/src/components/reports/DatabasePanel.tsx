import { useEffect, useMemo, useState } from "react";
import { api } from "../../api/client";
import { REPORT_TABS, type ReportTabId } from "../../config/reports";

type Props = {
  marketId: string;
  marketLabel: string;
  canDelete: boolean;
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
  onDeleted,
}: Props) {
  const [weeks, setWeeks] = useState<string[]>([]);
  const [loadingWeeks, setLoadingWeeks] = useState(false);
  const [selectedWeek, setSelectedWeek] = useState<string>("");
  const [selectedTable, setSelectedTable] = useState<TableChoice>(ALL_TABLES);

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
          <h2>DATABASE · DELETE DATA</h2>
          <p className="mr-readonly-note">
            Free up space by deleting raw upload data for {marketLabel}. Removing
            a raw source also clears the linked tables (Week Detail, Weekly
            Summary, Paid Comm, Bad Aff) for that week, since they can no longer
            be computed. Deletions require your password and are saved to History
            (restorable).
          </p>
        </div>
      </header>

      {message ? <p className="mr-import-message">{message}</p> : null}
      {!pending && error ? (
        <p className="mr-import-message mr-history-error">{error}</p>
      ) : null}

      {!canDelete ? (
        <p className="mr-no-data">
          You do not have permission to delete data. Admin access is required.
        </p>
      ) : (
        <div className="mr-database-grid">
          <article className="mr-database-card">
            <div className="mr-database-card-icon" aria-hidden>
              ▦
            </div>
            <h3>Delete data</h3>
            <p className="mr-database-card-desc">
              Pick a week, then delete a single raw table or every raw upload for
              that week. Linked tables are cleared automatically.
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
        </div>
      )}

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
