import { useCallback, useEffect, useState } from "react";
import {
  api,
  type ReportHistoryDetail,
  type ReportHistoryEntry,
} from "../../api/client";
import { periodCopy, userErrorMessage } from "../../config/reports";

type Props = {
  marketId: string;
  marketLabel: string;
  canRestore: boolean;
  onRestored: () => void;
};

const PAGE_SIZE = 10;

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function actionLabel(action: string): string {
  switch (action) {
    case "import":
      return "Import";
    case "edit":
      return "Edit";
    case "restore":
      return "Restore";
    case "clear":
      return "Clear";
    default:
      return action;
  }
}

export function HistoryPanel({ marketId, marketLabel, canRestore, onRestored }: Props) {
  const words = periodCopy(marketId);
  const [histories, setHistories] = useState<ReportHistoryEntry[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<ReportHistoryDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [restoringId, setRestoringId] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<ReportHistoryEntry | null>(
    null,
  );
  const [restorePassword, setRestorePassword] = useState("");

  useEffect(() => {
    setPage(1);
    setExpandedId(null);
    setDetail(null);
    setMessage(null);
  }, [marketId]);

  const loadList = useCallback(
    async (pageToLoad: number) => {
      setLoading(true);
      setError(null);
      try {
        const result = await api.getReportHistory({
          marketId,
          page: pageToLoad,
          pageSize: PAGE_SIZE,
        });
        setHistories(result.histories);
        setPage(result.page);
        setTotal(result.total);
        setTotalPages(result.totalPages);
      } catch (err) {
        setError(userErrorMessage(err, "Failed to load history", marketId));
        setHistories([]);
        setTotal(0);
        setTotalPages(1);
      } finally {
        setLoading(false);
      }
    },
    [marketId],
  );

  useEffect(() => {
    void loadList(page);
  }, [loadList, page]);

  async function toggleExpand(id: number) {
    if (expandedId === id) {
      setExpandedId(null);
      setDetail(null);
      return;
    }
    setExpandedId(id);
    setDetailLoading(true);
    setDetail(null);
    try {
      const result = await api.getReportHistoryDetail(id);
      setDetail(result.history);
    } catch (err) {
      setError(userErrorMessage(err, "Failed to load history detail", marketId));
    } finally {
      setDetailLoading(false);
    }
  }

  async function confirmRestore() {
    if (!canRestore || !restoreTarget || !restorePassword.trim()) return;

    const entry = restoreTarget;
    setRestoringId(entry.id);
    setMessage(null);
    setError(null);
    try {
      const result = await api.restoreReportHistory(entry.id, restorePassword);
      setMessage(
        `Restored ${result.restored} dataset(s) from history #${entry.id}.`,
      );
      setRestoreTarget(null);
      setRestorePassword("");
      setExpandedId(null);
      setDetail(null);
      setPage(1);
      await loadList(1);
      onRestored();
    } catch (err) {
      setError(userErrorMessage(err, "Failed to restore history", marketId));
    } finally {
      setRestoringId(null);
    }
  }

  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, total);

  return (
    <section className="mr-history panel">
      <header className="mr-history-header">
        <div>
          <h2>HISTORY · AUDIT TRAIL</h2>
          <p className="mr-readonly-note">
            Snapshots of imports and {words.detail} saves for {marketLabel}. Shows who made the
            change. Admins can restore a snapshot.
          </p>
        </div>
        <button
          type="button"
          className="mr-btn-secondary"
          onClick={() => void loadList(page)}
          disabled={loading}
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      {message ? <p className="mr-import-message">{message}</p> : null}
      {error ? <p className="mr-import-message mr-history-error">{error}</p> : null}

      {loading && histories.length === 0 ? (
        <p className="mr-readonly-note">Loading history…</p>
      ) : histories.length === 0 ? (
        <p className="mr-no-data">No history yet for this market. Import or edit data to create snapshots.</p>
      ) : (
        <div className="mr-history-table-wrap">
          <table className="mr-history-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Action</th>
                <th>User</th>
                <th>{words.Weeks}</th>
                <th>Summary</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {histories.map((entry) => {
                const userDisplay =
                  entry.userName?.trim() ||
                  entry.userEmail?.trim() ||
                  (entry.userId != null ? `User #${entry.userId}` : "Unknown");
                const expanded = expandedId === entry.id;

                return (
                  <tr key={entry.id} className={expanded ? "is-expanded" : undefined}>
                    <td>
                      <button
                        type="button"
                        className="mr-history-link"
                        onClick={() => void toggleExpand(entry.id)}
                      >
                        {formatWhen(entry.createdAt)}
                      </button>
                      <div className="mr-history-meta">#{entry.id}</div>
                    </td>
                    <td>
                      <span className={`mr-history-action action-${entry.action}`}>
                        {actionLabel(entry.action)}
                      </span>
                    </td>
                    <td>
                      <div>{userDisplay}</div>
                      {entry.userEmail && entry.userName ? (
                        <div className="mr-history-meta">{entry.userEmail}</div>
                      ) : null}
                    </td>
                    <td>{entry.weeks || "—"}</td>
                    <td>
                      <div className="mr-history-label">{entry.label}</div>
                      {entry.fileName ? (
                        <div className="mr-history-meta">{entry.fileName}</div>
                      ) : null}
                    </td>
                    <td className="mr-history-actions">
                      <button
                        type="button"
                        className="mr-btn-secondary mr-bulk-btn"
                        onClick={() => void toggleExpand(entry.id)}
                      >
                        {expanded ? "Hide" : "Details"}
                      </button>
                      {canRestore ? (
                        <button
                          type="button"
                          className="mr-btn-primary mr-bulk-btn"
                          disabled={restoringId === entry.id}
                          onClick={() => {
                            setRestorePassword("");
                            setRestoreTarget(entry);
                          }}
                        >
                          {restoringId === entry.id ? "Restoring…" : "Restore"}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {expandedId != null ? (
            <div className="mr-history-detail">
              {detailLoading ? (
                <p className="mr-readonly-note">Loading snapshot details…</p>
              ) : detail && detail.id === expandedId ? (
                <>
                  <h3>Snapshot contents</h3>
                  <ul className="mr-history-item-list">
                    {detail.items.map((item) => (
                      <li key={item.id}>
                        <strong>{item.tabId}</strong>
                        <span> · {item.week}</span>
                        <span> · {item.rowCount} row(s)</span>
                        {item.sheetName ? <span> · {item.sheetName}</span> : null}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="mr-readonly-note">Could not load details.</p>
              )}
            </div>
          ) : null}

          <div className="mr-history-pagination">
            <span className="mr-history-page-info">
              Showing {rangeStart}–{rangeEnd} of {total}
              {totalPages > 1 ? ` · Page ${page} of ${totalPages}` : null}
            </span>
            <div className="mr-history-page-actions">
              <button
                type="button"
                className="mr-btn-secondary mr-bulk-btn"
                disabled={loading || page <= 1}
                onClick={() => {
                  setExpandedId(null);
                  setDetail(null);
                  setPage((current) => Math.max(1, current - 1));
                }}
              >
                Previous
              </button>
              <button
                type="button"
                className="mr-btn-secondary mr-bulk-btn"
                disabled={loading || page >= totalPages}
                onClick={() => {
                  setExpandedId(null);
                  setDetail(null);
                  setPage((current) => Math.min(totalPages, current + 1));
                }}
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}

      {restoreTarget ? (
        <div
          className="mr-modal-backdrop"
          role="presentation"
          onClick={() => {
            if (restoringId != null) return;
            setRestoreTarget(null);
            setRestorePassword("");
          }}
        >
          <div
            className="mr-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="restore-history-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="mr-modal-header">
              <div>
                <h2 id="restore-history-title">Restore history</h2>
              </div>
              <button
                type="button"
                className="mr-modal-close"
                onClick={() => {
                  if (restoringId != null) return;
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
                Are you sure you want to restore this snapshot? This will overwrite
                current report data for the tabs/{words.weeks} in this snapshot.
              </p>
              <div className="mr-reject-review">
                <p className="mr-reject-review-count">Snapshot details</p>
                <ul className="mr-reject-username-list mr-backup-delete-details">
                  <li>
                    <strong>ID:</strong> #{restoreTarget.id}
                  </li>
                  <li>
                    <strong>When:</strong> {formatWhen(restoreTarget.createdAt)}
                  </li>
                  <li>
                    <strong>Action:</strong> {actionLabel(restoreTarget.action)}
                  </li>
                  <li>
                    <strong>User:</strong>{" "}
                    {restoreTarget.userName?.trim() ||
                      restoreTarget.userEmail?.trim() ||
                      (restoreTarget.userId != null
                        ? `User #${restoreTarget.userId}`
                        : "Unknown")}
                  </li>
                  <li>
                    <strong>{words.Weeks}:</strong> {restoreTarget.weeks || "—"}
                  </li>
                  <li>
                    <strong>Summary:</strong> {restoreTarget.label || "—"}
                  </li>
                  {restoreTarget.fileName ? (
                    <li>
                      <strong>File:</strong> {restoreTarget.fileName}
                    </li>
                  ) : null}
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
                disabled={restoringId != null}
              >
                No
              </button>
              <button
                type="button"
                className="mr-btn-primary"
                onClick={() => void confirmRestore()}
                disabled={restoringId != null || !restorePassword.trim()}
              >
                {restoringId != null ? "Restoring…" : "Yes, restore"}
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </section>
  );
}
