import { useEffect, useMemo, useRef, useState, type UIEvent } from "react";

type Props = {
  columns: string[];
  rows?: string[][];
  emptyRowCount?: number;
  rowHeight?: number;
  maxHeight?: number;
  editableColumns?: Set<string>;
  /** Columns rendered as Paid/Unpaid toggle instead of text input. */
  toggleColumns?: Set<string>;
  canEdit?: boolean;
  onCellCommit?: (rowIndex: number, column: string, value: string) => void;
};

type SortDir = "asc" | "desc";

function normalizeToggleStatus(value: string): "Paid" | "Unpaid" {
  return value.trim().toLowerCase() === "paid" ? "Paid" : "Unpaid";
}

/** Integer-only parse (optional commas / leading +−). Null if not a pure integer. */
function parseInteger(value: string): number | null {
  const text = String(value ?? "")
    .trim()
    .replace(/,/g, "");
  if (!text || !/^[+-]?\d+$/.test(text)) return null;
  const n = Number(text);
  return Number.isSafeInteger(n) ? n : null;
}

function compareCells(a: string, b: string): number {
  const left = String(a ?? "").trim();
  const right = String(b ?? "").trim();

  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;

  const leftInt = parseInteger(left);
  const rightInt = parseInteger(right);
  if (leftInt != null && rightInt != null) {
    return leftInt === rightInt ? 0 : leftInt < rightInt ? -1 : 1;
  }

  return left.localeCompare(right, undefined, {
    sensitivity: "base",
    numeric: false,
  });
}

export function DataGrid({
  columns,
  rows = [],
  emptyRowCount = 16,
  rowHeight = 34,
  maxHeight = 560,
  editableColumns,
  toggleColumns,
  canEdit = false,
  onCellCommit,
}: Props) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  useEffect(() => {
    setSortColumn(null);
    setSortDir("asc");
    setScrollTop(0);
    if (scrollerRef.current) scrollerRef.current.scrollTop = 0;
  }, [columns]);

  const sortedEntries = useMemo(() => {
    const entries = rows.map((row, index) => ({ row, index }));
    if (!sortColumn || rows.length === 0) return entries;

    const colIndex = columns.indexOf(sortColumn);
    if (colIndex < 0) return entries;

    const direction = sortDir === "asc" ? 1 : -1;
    return [...entries].sort((a, b) => {
      const cmp = compareCells(a.row[colIndex] ?? "", b.row[colIndex] ?? "");
      return cmp === 0 ? a.index - b.index : cmp * direction;
    });
  }, [rows, columns, sortColumn, sortDir]);

  const displayEntries = useMemo(() => {
    if (rows.length > 0) return sortedEntries;
    return Array.from({ length: emptyRowCount }, (_, index) => ({
      row: Array.from({ length: columns.length }, () => ""),
      index,
    }));
  }, [rows.length, sortedEntries, emptyRowCount, columns.length]);

  const isVirtual = displayEntries.length > 80;
  const overscan = 12;
  const visibleCount = Math.ceil(maxHeight / rowHeight) + overscan * 2;
  const startIndex = isVirtual
    ? Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
    : 0;
  const endIndex = isVirtual
    ? Math.min(displayEntries.length, startIndex + visibleCount)
    : displayEntries.length;
  const slice = displayEntries.slice(startIndex, endIndex);
  const topPad = startIndex * rowHeight;
  const bottomPad = (displayEntries.length - endIndex) * rowHeight;

  function onScroll(event: UIEvent<HTMLDivElement>) {
    if (!isVirtual) return;
    setScrollTop(event.currentTarget.scrollTop);
  }

  function toggleSort(column: string) {
    if (rows.length === 0) return;

    if (sortColumn !== column) {
      setSortColumn(column);
      setSortDir("asc");
    } else if (sortDir === "asc") {
      setSortDir("desc");
    } else {
      setSortColumn(null);
      setSortDir("asc");
    }

    setScrollTop(0);
    if (scrollerRef.current) scrollerRef.current.scrollTop = 0;
  }

  return (
    <div
      className="mr-grid-wrap"
      ref={scrollerRef}
      onScroll={onScroll}
      style={{ maxHeight }}
    >
      <table className="mr-grid">
        <thead>
          <tr>
            {columns.map((column) => {
              const active = sortColumn === column;
              const ariaSort = !active
                ? "none"
                : sortDir === "asc"
                  ? "ascending"
                  : "descending";

              return (
                <th key={column} aria-sort={ariaSort}>
                  <button
                    type="button"
                    className={`mr-sort-btn${active ? " is-active" : ""}`}
                    onClick={() => toggleSort(column)}
                    disabled={rows.length === 0}
                    title={
                      rows.length === 0
                        ? "No data to sort"
                        : active
                          ? sortDir === "asc"
                            ? "Sorted ascending — click for descending"
                            : "Sorted descending — click to clear"
                          : "Sort ascending"
                    }
                  >
                    <span className="mr-sort-label">{column}</span>
                    <span className="mr-sort-indicator" aria-hidden="true">
                      {active ? (sortDir === "asc" ? "▲" : "▼") : "⇅"}
                    </span>
                    {canEdit && editableColumns?.has(column) ? (
                      <span className="mr-edit-tag">edit</span>
                    ) : null}
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {isVirtual && topPad > 0 ? (
            <tr aria-hidden="true">
              <td
                colSpan={columns.length}
                style={{ height: topPad, padding: 0, border: 0 }}
              />
            </tr>
          ) : null}

          {slice.map((entry, index) => {
            const row = entry.row;
            const sourceIndex = entry.index;
            const rowKey = `${startIndex + index}-${sourceIndex}`;

            return (
              <tr key={rowKey}>
                {columns.map((column, colIndex) => {
                  const editable = Boolean(
                    canEdit &&
                      rows.length > 0 &&
                      editableColumns?.has(column) &&
                      onCellCommit,
                  );
                  const isToggle = Boolean(toggleColumns?.has(column));
                  const value = row[colIndex] ?? "";
                  const status = normalizeToggleStatus(value);

                  return (
                    <td
                      key={column}
                      className={editable ? "mr-cell-editable" : undefined}
                    >
                      {editable && isToggle ? (
                        <button
                          type="button"
                          className={`mr-status-toggle ${status === "Paid" ? "is-paid" : "is-unpaid"}`}
                          onClick={() => {
                            const next = status === "Paid" ? "Unpaid" : "Paid";
                            if (next !== status) {
                              onCellCommit?.(sourceIndex, column, next);
                            }
                          }}
                          title="Toggle Paid / Unpaid"
                        >
                          {status}
                        </button>
                      ) : editable ? (
                        <input
                          className="mr-cell-input"
                          defaultValue={value}
                          key={`${sourceIndex}-${column}-${value}`}
                          onBlur={(event) => {
                            const next = event.target.value;
                            if (next !== value) {
                              onCellCommit?.(sourceIndex, column, next);
                            }
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              (event.target as HTMLInputElement).blur();
                            }
                          }}
                        />
                      ) : isToggle && rows.length > 0 ? (
                        <span
                          className={`mr-status-badge ${status === "Paid" ? "is-paid" : "is-unpaid"}`}
                        >
                          {status}
                        </span>
                      ) : (
                        value
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}

          {isVirtual && bottomPad > 0 ? (
            <tr aria-hidden="true">
              <td
                colSpan={columns.length}
                style={{ height: bottomPad, padding: 0, border: 0 }}
              />
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
