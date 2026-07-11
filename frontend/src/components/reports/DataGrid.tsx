import { useMemo, useRef, useState, type UIEvent } from "react";

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

function normalizeToggleStatus(value: string): "Paid" | "Unpaid" {
  return value.trim().toLowerCase() === "paid" ? "Paid" : "Unpaid";
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

  const displayRows = useMemo(() => {
    if (rows.length > 0) return rows;
    return Array.from({ length: emptyRowCount }, () =>
      Array.from({ length: columns.length }, () => ""),
    );
  }, [rows, emptyRowCount, columns.length]);

  const isVirtual = displayRows.length > 80;
  const overscan = 12;
  const visibleCount = Math.ceil(maxHeight / rowHeight) + overscan * 2;
  const startIndex = isVirtual
    ? Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
    : 0;
  const endIndex = isVirtual
    ? Math.min(displayRows.length, startIndex + visibleCount)
    : displayRows.length;
  const slice = displayRows.slice(startIndex, endIndex);
  const topPad = startIndex * rowHeight;
  const bottomPad = (displayRows.length - endIndex) * rowHeight;

  function onScroll(event: UIEvent<HTMLDivElement>) {
    if (!isVirtual) return;
    setScrollTop(event.currentTarget.scrollTop);
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
            {columns.map((column) => (
              <th key={column}>
                {column}
                {canEdit && editableColumns?.has(column) ? (
                  <span className="mr-edit-tag">edit</span>
                ) : null}
              </th>
            ))}
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

          {slice.map((row, index) => {
            const rowIndex = startIndex + index;
            return (
              <tr key={rowIndex}>
                {columns.map((column, colIndex) => {
                  const editable = Boolean(
                    canEdit && rows.length > 0 && editableColumns?.has(column) && onCellCommit,
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
                            if (next !== status) onCellCommit?.(rowIndex, column, next);
                          }}
                          title="Toggle Paid / Unpaid"
                        >
                          {status}
                        </button>
                      ) : editable ? (
                        <input
                          className="mr-cell-input"
                          defaultValue={value}
                          key={`${rowIndex}-${column}-${value}`}
                          onBlur={(event) => {
                            const next = event.target.value;
                            if (next !== value) onCellCommit?.(rowIndex, column, next);
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
