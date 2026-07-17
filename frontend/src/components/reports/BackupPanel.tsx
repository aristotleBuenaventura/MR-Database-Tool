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

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const result = await api.listBackups({ marketId });
      setBackups(result.backups);
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
      const result = await api.updateBackupSchedule({ enabled, time });
      setSchedule(result.schedule);
      setEnabled(result.schedule.enabled);
      setTime(result.schedule.time);
      setMessage(
        result.schedule.enabled
          ? `Auto-backup scheduled daily at ${result.schedule.time} (PH time).`
          : "Auto-backup disabled.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save schedule");
    } finally {
      setBusy(false);
    }
  }

  async function handleRestore() {
    if (!restoreTarget || busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api.restoreBackup(restoreTarget.id);
      setMessage(
        `Restored ${result.restored} table(s) from backup #${restoreTarget.id}. Open another tab to reload.`,
      );
      setRestoreTarget(null);
      onRestored();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to restore backup");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(backup: BackupEntry) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await api.deleteBackup(backup.id);
      setMessage(`Deleted backup #${backup.id}.`);
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
            Create a snapshot of {marketLabel}'s data on demand, or schedule a
            daily auto-backup. Every backup can be restored, which replaces this
            market's current data with the snapshot. Times use Philippine time
            (Asia/Manila, UTC+8).
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
            <div className="mr-database-card-icon" aria-hidden>
              ⬢
            </div>
            <h3>Manual backup</h3>
            <p className="mr-database-card-desc">
              Capture a snapshot of every table for {marketLabel} right now. It
              appears in the list below and can be restored anytime.
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
            <div className="mr-database-card-icon" aria-hidden>
              ◷
            </div>
            <h3>Auto backup</h3>
            <p className="mr-database-card-desc">
              Run a backup automatically every day at the chosen time for each
              market (Philippine time).
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
                Last auto-backup: {schedule.lastRunDate}
              </p>
            ) : null}
          </article>
        </div>
      ) : null}

      <div className="mr-backup-list">
        <h3>Backups {loading ? "" : `(${backups.length})`}</h3>
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
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {backups.map((backup) => (
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
                  <td className="mr-backup-actions">
                    {canManage ? (
                      <>
                        <button
                          type="button"
                          className="mr-btn-secondary"
                          onClick={() => setRestoreTarget(backup)}
                          disabled={busy}
                        >
                          Restore
                        </button>
                        <button
                          type="button"
                          className="mr-btn-ghost-danger"
                          onClick={() => void handleDelete(backup)}
                          disabled={busy}
                        >
                          Delete
                        </button>
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {restoreTarget ? (
        <div
          className="mr-modal-backdrop"
          role="presentation"
          onClick={() => !busy && setRestoreTarget(null)}
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
                onClick={() => !busy && setRestoreTarget(null)}
                aria-label="Close"
              >
                ×
              </button>
            </header>
            <div className="mr-modal-body">
              <p className="mr-modal-hint">
                Restore the backup from{" "}
                <strong>{formatPhDateTime(restoreTarget.createdAt)}</strong> (
                {restoreTarget.itemCount} table(s)). This{" "}
                <strong>replaces all current data for {marketLabel}</strong> with
                this snapshot. Data added to this market after the backup will be
                removed.
              </p>
            </div>
            <footer className="mr-modal-footer">
              <button
                type="button"
                className="mr-btn-secondary"
                onClick={() => setRestoreTarget(null)}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="mr-btn-primary"
                onClick={() => void handleRestore()}
                disabled={busy}
              >
                {busy ? "Restoring…" : "Restore now"}
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </section>
  );
}
