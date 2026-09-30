import { useEffect, useState } from "react";
import {
  api,
  type BackupEntry,
  type BackupSchedule,
} from "../../api/client";

type Props = {
  marketId: string;
  marketLabel: string;
  canManage: boolean;
  onRestored: () => void;
};

const PH_TIME_ZONE = "Asia/Manila";
const PAGE_SIZE = 5;

function formatPhDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: PH_TIME_ZONE,
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

export function BackupPanel({
  marketId,
  marketLabel,
  canManage,
  onRestored,
}: Props) {
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [schedule, setSchedule] = useState<BackupSchedule | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Local editable copies for the schedule form.
  const [enabled, setEnabled] = useState(false);
  const [time, setTime] = useState("02:00");

  const [restoreTarget, setRestoreTarget] = useState<BackupEntry | null>(null);
  const [restorePassword, setRestorePassword] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<BackupEntry | null>(null);
  const [page, setPage] = useState(1);

  const totalPages = Math.max(1, Math.ceil(backups.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedBackups = backups.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );
  const rangeStart =
    backups.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(currentPage * PAGE_SIZE, backups.length);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const result = await api.listBackups({ marketId });
      setBackups(result.backups);
      setPage(1);
      setSchedule(result.schedule);
      setEnabled(result.schedule.enabled);
      setTime(result.schedule.time);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load backups");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marketId]);

  async function handleManualBackup() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api.createBackup({ marketId });
      setMessage(
        `Backup created for ${marketLabel} — ${result.backup.itemCount} table(s), ${result.backup.rowCount.toLocaleString()} row(s).`,
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create backup");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveSchedule() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api.updateBackupSchedule({
        marketId,
        enabled,
        time,
      });
      setSchedule(result.schedule);
      setEnabled(result.schedule.enabled);
      setTime(result.schedule.time);
      setMessage(
        result.schedule.enabled
          ? `Auto-backup for ${marketLabel} runs daily at ${result.schedule.time} (PH time). Other brands keep their own time.`
          : `Auto-backup disabled for ${marketLabel}.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save schedule");
    } finally {
      setBusy(false);
    }
  }

  async function handleRestore() {
    if (!restoreTarget || busy || !restorePassword.trim()) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api.restoreBackup(restoreTarget.id, restorePassword);
      setMessage(
        `Restored ${result.restored} table(s) from backup #${restoreTarget.id}. Open another tab to reload.`,
      );
      setRestoreTarget(null);
      setRestorePassword("");
      onRestored();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to restore backup");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget || busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await api.deleteBackup(deleteTarget.id);
      setMessage(`Deleted backup #${deleteTarget.id}.`);
      setDeleteTarget(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete backup");
    } finally {
      setBusy(false);
    }
  }

  const scheduleDirty =
    schedule != null && (enabled !== schedule.enabled || time !== schedule.time);

  return (
    <section className="mr-database panel">
      <header className="mr-database-header">
        <div>
          <h2>DATABASE · BACKUP &amp; RESTORE</h2>
          <p className="mr-readonly-note">
            Snapshot {marketLabel}'s data on demand or on a daily schedule.
            Restoring replaces this market's data with the snapshot. Times use
            Philippine time (UTC+8).
          </p>
        </div>
      </header>

      {message ? <p className="mr-import-message">{message}</p> : null}
      {error ? (
        <p className="mr-import-message mr-history-error">{error}</p>
      ) : null}

      {canManage ? (
        <div className="mr-database-grid">
          <article className="mr-database-card">
            <div className="mr-database-card-head">
              <div className="mr-database-card-icon" aria-hidden>
                ⬢
              </div>
              <h3>Manual backup</h3>
            </div>
            <p className="mr-database-card-desc">
              Snapshot every table for {marketLabel} now. It appears below and
              can be restored anytime.
            </p>
            <button
              type="button"
              className="mr-btn-primary mr-database-upload-btn"
              onClick={() => void handleManualBackup()}
              disabled={busy}
            >
              {busy ? "Working…" : "Back up now"}
            </button>
          </article>

          <article className="mr-database-card">
            <div className="mr-database-card-head">
              <div className="mr-database-card-icon" aria-hidden>
                ◷
              </div>
              <h3>Auto backup</h3>
            </div>
            <p className="mr-database-card-desc">
              Daily auto-backup for {marketLabel} only, at the chosen time (PH).
              Other brands are not changed.
            </p>
            <label className="mr-database-toggle">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(event) => setEnabled(event.target.checked)}
              />
              <span>Enable daily auto-backup</span>
            </label>
            <label className="mr-database-field">
              <span>Time (PH)</span>
              <input
                type="time"
                value={time}
                disabled={!enabled}
                onChange={(event) => setTime(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="mr-btn-primary"
              onClick={() => void handleSaveSchedule()}
              disabled={busy || !scheduleDirty}
            >
              Save schedule
            </button>
            {schedule?.lastRunDate ? (
              <p className="mr-field-hint">
                Last auto-backup for {marketLabel}: {schedule.lastRunDate}
              </p>
            ) : null}
          </article>
        </div>
      ) : null}

      <div className="mr-backup-list">
        <h3>
          Backups {loading ? "" : `(${backups.length})`}
          <span className="mr-backup-cap"> · keeps latest 20 per market</span>
        </h3>
        {loading ? (
          <p className="mr-import-message">Loading backups…</p>
        ) : backups.length === 0 ? (
          <p className="mr-no-data">No backups yet.</p>
        ) : (
          <table className="mr-backup-table">
            <thead>
              <tr>
                <th>Created (PH)</th>
                <th>Type</th>
                <th>Label</th>
                <th className="mr-num">Tables</th>
                <th className="mr-num">Rows</th>
                <th>By</th>
                {canManage ? <th aria-label="Actions" /> : null}
              </tr>
            </thead>
            <tbody>
              {pagedBackups.map((backup) => (
                <tr key={backup.id}>
                  <td>{formatPhDateTime(backup.createdAt)}</td>
                  <td>
                    <span
                      className={`mr-backup-tag ${
                        backup.trigger === "scheduled"
                          ? "mr-backup-tag-auto"
                          : "mr-backup-tag-manual"
                      }`}
                    >
                      {backup.trigger === "scheduled" ? "Auto" : "Manual"}
                    </span>
                  </td>
                  <td>{backup.label}</td>
                  <td className="mr-num">{backup.itemCount.toLocaleString()}</td>
                  <td className="mr-num">{backup.rowCount.toLocaleString()}</td>
                  <td>{backup.userName || backup.userEmail || "—"}</td>
                  {canManage ? (
                    <td>
                      <div className="mr-backup-actions">
                        <button
                          type="button"
                          className="mr-btn-secondary"
                          onClick={() => {
                            setRestorePassword("");
                            setRestoreTarget(backup);
                          }}
                          disabled={busy}
                        >
                          Restore
                        </button>
                        <button
                          type="button"
                          className="mr-btn-ghost-danger"
                          onClick={() => setDeleteTarget(backup)}
                          disabled={busy}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {!loading && backups.length > 0 ? (
          <div className="mr-history-pagination">
            <span className="mr-history-page-info">
              Showing {rangeStart}–{rangeEnd} of {backups.length}
              {totalPages > 1 ? ` · Page ${currentPage} of ${totalPages}` : null}
            </span>
            <div className="mr-history-page-actions">
              <button
                type="button"
                className="mr-btn-secondary mr-bulk-btn"
                disabled={currentPage <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                Previous
              </button>
              <button
                type="button"
                className="mr-btn-secondary mr-bulk-btn"
                disabled={currentPage >= totalPages}
                onClick={() =>
                  setPage((current) => Math.min(totalPages, current + 1))
                }
              >
                Next
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {restoreTarget ? (
        <div
          className="mr-modal-backdrop"
          role="presentation"
          onClick={() => {
            if (busy) return;
            setRestoreTarget(null);
            setRestorePassword("");
          }}
        >
          <div
            className="mr-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="restore-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="mr-modal-header">
              <div>
                <h2 id="restore-title">Restore backup</h2>
              </div>
              <button
                type="button"
                className="mr-modal-close"
                onClick={() => {
                  if (busy) return;
                  setRestoreTarget(null);
                  setRestorePassword("");
                }}
                aria-label="Close"
              >
                ×
              </button>
            </header>
            <div className="mr-modal-body">
              <p className="mr-modal-hint">
                Are you sure you want to restore this backup? This{" "}
                <strong>replaces all current data for {marketLabel}</strong> with
                this snapshot. Data added after the backup will be removed.
              </p>
              <div className="mr-reject-review">
                <p className="mr-reject-review-count">Backup details</p>
                <ul className="mr-reject-username-list mr-backup-delete-details">
                  <li>
                    <strong>Created:</strong>{" "}
                    {formatPhDateTime(restoreTarget.createdAt)}
                  </li>
                  <li>
                    <strong>Type:</strong>{" "}
                    {restoreTarget.trigger === "scheduled" ? "Auto" : "Manual"}
                  </li>
                  <li>
                    <strong>Label:</strong> {restoreTarget.label || "—"}
                  </li>
                  <li>
                    <strong>Tables:</strong>{" "}
                    {restoreTarget.itemCount.toLocaleString()}
                  </li>
                  <li>
                    <strong>Rows:</strong>{" "}
                    {restoreTarget.rowCount.toLocaleString()}
                  </li>
                  <li>
                    <strong>By:</strong>{" "}
                    {restoreTarget.userName || restoreTarget.userEmail || "—"}
                  </li>
                </ul>
              </div>
              <label className="mr-database-field">
                <span>Password</span>
                <input
                  type="password"
                  value={restorePassword}
                  onChange={(event) => setRestorePassword(event.target.value)}
                  autoComplete="current-password"
                  placeholder="Your account password"
                />
              </label>
            </div>
            <footer className="mr-modal-footer">
              <button
                type="button"
                className="mr-btn-secondary"
                onClick={() => {
                  setRestoreTarget(null);
                  setRestorePassword("");
                }}
                disabled={busy}
              >
                No
              </button>
              <button
                type="button"
                className="mr-btn-primary"
                onClick={() => void handleRestore()}
                disabled={busy || !restorePassword.trim()}
              >
                {busy ? "Restoring…" : "Yes, restore"}
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {deleteTarget ? (
        <div
          className="mr-modal-backdrop"
          role="presentation"
          onClick={() => !busy && setDeleteTarget(null)}
        >
          <div
            className="mr-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-backup-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="mr-modal-header">
              <div>
                <h2 id="delete-backup-title">Delete backup</h2>
              </div>
              <button
                type="button"
                className="mr-modal-close"
                onClick={() => !busy && setDeleteTarget(null)}
                aria-label="Close"
              >
                ×
              </button>
            </header>
            <div className="mr-modal-body">
              <p className="mr-modal-hint">
                Are you sure you want to delete this backup? This cannot be undone.
              </p>
              <div className="mr-reject-review">
                <p className="mr-reject-review-count">Backup details</p>
                <ul className="mr-reject-username-list mr-backup-delete-details">
                  <li>
                    <strong>Created:</strong> {formatPhDateTime(deleteTarget.createdAt)}
                  </li>
                  <li>
                    <strong>Type:</strong>{" "}
                    {deleteTarget.trigger === "scheduled" ? "Auto" : "Manual"}
                  </li>
                  <li>
                    <strong>Label:</strong> {deleteTarget.label || "—"}
                  </li>
                  <li>
                    <strong>Tables:</strong> {deleteTarget.itemCount.toLocaleString()}
                  </li>
                  <li>
                    <strong>Rows:</strong> {deleteTarget.rowCount.toLocaleString()}
                  </li>
                  <li>
                    <strong>By:</strong>{" "}
                    {deleteTarget.userName || deleteTarget.userEmail || "—"}
                  </li>
                </ul>
              </div>
            </div>
            <footer className="mr-modal-footer">
              <button
                type="button"
                className="mr-btn-secondary"
                onClick={() => setDeleteTarget(null)}
                disabled={busy}
              >
                No
              </button>
              <button
                type="button"
                className="mr-btn-primary"
                onClick={() => void handleDelete()}
                disabled={busy}
              >
                {busy ? "Deleting…" : "Yes, delete"}
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </section>
  );
}
