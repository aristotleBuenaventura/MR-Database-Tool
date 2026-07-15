import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type UIEvent,
} from "react";

type SortDir = "asc" | "desc";

type Props = {
  columns: string[];
  rows?: string[][];
  emptyRowCount?: number;
  rowHeight?: number;
  maxHeight?: number;
  editableColumns?: Set<string>;
  /** Columns rendered as Paid/Unpaid/Reject status control when editable. */
  toggleColumns?: Set<string>;
  canEdit?: boolean;
  onCellCommit?: (rowIndex: number, column: string, value: string) => void;
  /** Enable checkbox column; indices are into the `rows` prop. */
  selectable?: boolean;
  selectedIndices?: Set<number>;
  onSelectionChange?: (indices: Set<number>) => void;
  /** Applied on mount / when columns change (e.g. Week Detail Final Commission desc). */
  defaultSortColumn?: string | null;
  defaultSortDir?: SortDir;
};

type DragSelectState = {
  active: boolean;
  paint: boolean;
  startVisual: number;
  baseSelection: Set<number>;
};

function normalizeToggleStatus(value: string): "Paid" | "Unpaid" {
  return value.trim().toLowerCase() === "paid" ? "Paid" : "Unpaid";
}

const STATUS_OPTIONS = ["Unpaid", "Paid", "Reject"] as const;

/** Parse numeric cells: integers, decimals, commas, %, and (123) negatives. */
function parseNumber(value: string): number | null {
  let text = String(value ?? "")
    .trim()
    .replace(/,/g, "");
  if (!text) return null;

  const paren = /^\(\s*([\d.]+)\s*%?\s*\)$/.exec(text);
  if (paren) {
    const n = Number(paren[1]);
    return Number.isFinite(n) ? -Math.abs(n) : null;
  }

  text = text.replace(/%$/, "");
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) return null;

  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function isBlankCell(value: unknown): boolean {
  return String(value ?? "").trim() === "";
}

function compareCells(a: string, b: string): number {
  const left = String(a ?? "").trim();
  const right = String(b ?? "").trim();

  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;

  const leftNum = parseNumber(left);
  const rightNum = parseNumber(right);
  if (leftNum != null && rightNum != null) {
    if (leftNum === rightNum) return 0;
    return leftNum < rightNum ? -1 : 1;
  }

  return left.localeCompare(right, undefined, {
    sensitivity: "base",
    numeric: true,
  });
}

/** Display numbers as whole values without changing the stored cell used for edits/sort. */
function formatWholeNumberDisplay(column: string, value: string): string {
  const text = String(value ?? "").trim();
  if (!text) return value;
  if (column === "Status" || column === "Comm %" || text.endsWith("%")) return value;
  if (/^\d{4}W\d{2}$/i.test(text)) return value;
  // Non-numeric labels (usernames, etc.)
  if (!/^[\d,.\-+%()]+$/.test(text.replace(/\s/g, ""))) return value;

  const n = parseNumber(text);
  if (n == null) return value;
  return String(Math.round(n));
}

/** True for numeric cells that are negative (supports commas, decimals, %, and (123) style). */
function isNegativeNumeric(value: unknown): boolean {
  const n = parseNumber(String(value ?? ""));
  return n != null && n < 0;
}

const EMPTY_SELECTION = new Set<number>();

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
  selectable = false,
  selectedIndices,
  onSelectionChange,
  defaultSortColumn = null,
  defaultSortDir = "asc",
}: Props) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragSelectState | null>(null);
  const displayEntriesRef = useRef<{ row: string[]; index: number }[]>([]);
  const selectedRef = useRef<Set<number>>(EMPTY_SELECTION);
  const anchorVisualRef = useRef<number | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [sortColumn, setSortColumn] = useState<string | null>(() =>
    defaultSortColumn && columns.includes(defaultSortColumn) ? defaultSortColumn : null,
  );
  const [sortDir, setSortDir] = useState<SortDir>(() =>
    defaultSortColumn && columns.includes(defaultSortColumn) ? defaultSortDir : "asc",
  );
  const [rejectConfirm, setRejectConfirm] = useState<{
    rowIndex: number;
    column: string;
    affiliate: string;
  } | null>(null);
  const [isDragSelecting, setIsDragSelecting] = useState(false);

  const selected = selectedIndices ?? EMPTY_SELECTION;
  selectedRef.current = selected;
  const selectionEnabled = Boolean(selectable && onSelectionChange && rows.length > 0);
  const colSpan = columns.length + (selectionEnabled ? 1 : 0);

  useEffect(() => {
    const nextColumn =
      defaultSortColumn && columns.includes(defaultSortColumn) ? defaultSortColumn : null;
    setSortColumn(nextColumn);
    setSortDir(nextColumn ? defaultSortDir : "asc");
    setScrollTop(0);
    anchorVisualRef.current = null;
    if (scrollerRef.current) scrollerRef.current.scrollTop = 0;
  }, [columns, defaultSortColumn, defaultSortDir]);

  const sortedEntries = useMemo(() => {
    const entries = rows.map((row, index) => ({ row, index }));
    if (!sortColumn || rows.length === 0) return entries;

    const colIndex = columns.indexOf(sortColumn);
    if (colIndex < 0) return entries;

    const direction = sortDir === "asc" ? 1 : -1;
    return [...entries].sort((a, b) => {
      const aVal = a.row[colIndex] ?? "";
      const bVal = b.row[colIndex] ?? "";
      const aBlank = isBlankCell(aVal);
      const bBlank = isBlankCell(bVal);
      // Always push blank cells to the bottom, even when sorting desc.
      if (aBlank !== bBlank) return aBlank ? 1 : -1;

      const cmp = compareCells(aVal, bVal);
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

  displayEntriesRef.current = displayEntries;

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

  const allSelected =
    selectionEnabled && rows.length > 0 && rows.every((_, index) => selected.has(index));
  const someSelected =
    selectionEnabled && !allSelected && rows.some((_, index) => selected.has(index));

  function applyVisualRange(
    fromVisual: number,
    toVisual: number,
    paint: boolean,
    baseSelection: Set<number>,
  ) {
    if (!onSelectionChange) return;
    const lo = Math.max(0, Math.min(fromVisual, toVisual));
    const hi = Math.min(
      displayEntriesRef.current.length - 1,
      Math.max(fromVisual, toVisual),
    );
    const next = new Set(baseSelection);
    for (let visual = lo; visual <= hi; visual += 1) {
      const sourceIndex = displayEntriesRef.current[visual]?.index;
      if (sourceIndex == null) continue;
      if (paint) next.add(sourceIndex);
      else next.delete(sourceIndex);
    }
    onSelectionChange(next);
  }

  function visualIndexFromPoint(clientX: number, clientY: number): number | null {
    const hit = document.elementFromPoint(clientX, clientY);
    const cell = hit?.closest?.("[data-visual-index]") as HTMLElement | null;
    if (!cell) return null;
    const visual = Number(cell.dataset.visualIndex);
    return Number.isFinite(visual) ? visual : null;
  }

  function autoScrollDuringDrag(clientY: number) {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const rect = scroller.getBoundingClientRect();
    const edge = 36;
    if (clientY < rect.top + edge) {
      scroller.scrollTop -= 18;
      setScrollTop(scroller.scrollTop);
    } else if (clientY > rect.bottom - edge) {
      scroller.scrollTop += 18;
      setScrollTop(scroller.scrollTop);
    }
  }

  useEffect(() => {
    if (!isDragSelecting) return;

    function onPointerMove(event: PointerEvent) {
      const drag = dragRef.current;
      if (!drag?.active) return;
      autoScrollDuringDrag(event.clientY);
      const visual = visualIndexFromPoint(event.clientX, event.clientY);
      if (visual == null) return;
      applyVisualRange(drag.startVisual, visual, drag.paint, drag.baseSelection);
    }

    function endDrag() {
      if (dragRef.current) dragRef.current.active = false;
      dragRef.current = null;
      setIsDragSelecting(false);
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
    };
  }, [isDragSelecting, onSelectionChange]);

  function onScroll(event: UIEvent<HTMLDivElement>) {
    if (!isVirtual && !isDragSelecting) return;
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
    anchorVisualRef.current = null;
    if (scrollerRef.current) scrollerRef.current.scrollTop = 0;
  }

  function toggleSelectAll() {
    if (!onSelectionChange || rows.length === 0) return;
    if (allSelected) {
      onSelectionChange(new Set());
      return;
    }
    onSelectionChange(new Set(rows.map((_, index) => index)));
  }

  function beginRowSelectDrag(
    event: ReactPointerEvent<HTMLTableCellElement>,
    visualIndex: number,
    sourceIndex: number,
  ) {
    if (!onSelectionChange || event.button !== 0) return;
    event.preventDefault();

    // Shift+click: select/deselect range from last anchor (display order).
    if (event.shiftKey && anchorVisualRef.current != null) {
      const paint = !selectedRef.current.has(sourceIndex);
      applyVisualRange(anchorVisualRef.current, visualIndex, paint, selectedRef.current);
      anchorVisualRef.current = visualIndex;
      return;
    }

    const paint = !selectedRef.current.has(sourceIndex);
    dragRef.current = {
      active: true,
      paint,
      startVisual: visualIndex,
      baseSelection: new Set(selectedRef.current),
    };
    anchorVisualRef.current = visualIndex;
    applyVisualRange(visualIndex, visualIndex, paint, dragRef.current.baseSelection);
    setIsDragSelecting(true);
  }

  function confirmReject() {
    if (!rejectConfirm) return;
    onCellCommit?.(rejectConfirm.rowIndex, rejectConfirm.column, "Reject");
    setRejectConfirm(null);
  }

  function cancelReject() {
    setRejectConfirm(null);
  }

  return (
    <>
      <div
        className={`mr-grid-wrap${isDragSelecting ? " is-drag-selecting" : ""}`}
        ref={scrollerRef}
        onScroll={onScroll}
        style={{ maxHeight }}
      >
        <table className="mr-grid">
          <thead>
            <tr>
              {selectionEnabled ? (
                <th className="mr-select-col" scope="col">
                  <input
                    type="checkbox"
                    className="mr-row-check"
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someSelected;
                    }}
                    onChange={toggleSelectAll}
                    aria-label="Select all rows"
                    title={allSelected ? "Clear selection" : "Select all rows"}
                  />
                </th>
              ) : null}
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
                  colSpan={colSpan}
                  style={{ height: topPad, padding: 0, border: 0 }}
                />
              </tr>
            ) : null}

            {slice.map((entry, index) => {
              const row = entry.row;
              const sourceIndex = entry.index;
              const visualIndex = startIndex + index;
              const rowKey = `${visualIndex}-${sourceIndex}`;
              const isSelected = selectionEnabled && selected.has(sourceIndex);

              return (
                <tr
                  key={rowKey}
                  className={isSelected ? "mr-row-selected" : undefined}
                  data-visual-index={selectionEnabled ? visualIndex : undefined}
                >
                  {selectionEnabled ? (
                    <td
                      className="mr-select-col"
                      data-visual-index={visualIndex}
                      onPointerDown={(event) =>
                        beginRowSelectDrag(event, visualIndex, sourceIndex)
                      }
                      title="Click to select · Drag to multi-select · Shift+click for range"
                    >
                      <input
                        type="checkbox"
                        className="mr-row-check"
                        checked={isSelected}
                        readOnly
                        tabIndex={-1}
                        aria-label={`Select row ${sourceIndex + 1}`}
                      />
                    </td>
                  ) : null}
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
                    const displayValue = formatWholeNumberDisplay(column, value);
                    const negative = !isToggle && isNegativeNumeric(value);

                    return (
                      <td
                        key={column}
                        className={[
                          editable ? "mr-cell-editable" : "",
                          negative ? "mr-cell-negative" : "",
                        ]
                          .filter(Boolean)
                          .join(" ") || undefined}
                      >
                        {editable && isToggle ? (
                          <select
                            className={`mr-status-select ${
                              status === "Paid" ? "is-paid" : "is-unpaid"
                            }`}
                            value={status}
                            aria-label={`${column} status`}
                            onChange={(event) => {
                              const next = event.target.value;
                              if (next === status) return;
                              if (next === "Reject") {
                                const affiliate =
                                  row[
                                    columns.findIndex(
                                      (c) => c.toLowerCase() === "affiliate username",
                                    )
                                  ] ?? "";
                                setRejectConfirm({
                                  rowIndex: sourceIndex,
                                  column,
                                  affiliate: String(affiliate).trim(),
                                });
                                return;
                              }
                              onCellCommit?.(sourceIndex, column, next);
                            }}
                          >
                            {STATUS_OPTIONS.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        ) : editable ? (
                          <input
                            className={`mr-cell-input${negative ? " is-negative" : ""}`}
                            defaultValue={displayValue}
                            key={`${sourceIndex}-${column}-${value}`}
                            onBlur={(event) => {
                              const next = event.target.value;
                              if (next !== value && next !== displayValue) {
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
                          displayValue
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
                  colSpan={colSpan}
                  style={{ height: bottomPad, padding: 0, border: 0 }}
                />
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {rejectConfirm ? (
        <div className="mr-modal-backdrop" role="presentation" onClick={cancelReject}>
          <div
            className="mr-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reject-confirm-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="mr-modal-header">
              <div>
                <h2 id="reject-confirm-title">Reject row</h2>
              </div>
              <button
                type="button"
                className="mr-modal-close"
                onClick={cancelReject}
                aria-label="Close"
              >
                ×
              </button>
            </header>
            <div className="mr-modal-body">
              <p className="mr-modal-hint">
                Are you sure you want to reject this
                {rejectConfirm.affiliate ? (
                  <>
                    {" "}
                    (<strong>{rejectConfirm.affiliate}</strong>)
                  </>
                ) : null}
                ? This will delete the row from Week Detail.
              </p>
            </div>
            <footer className="mr-modal-footer">
              <button type="button" className="mr-btn-secondary" onClick={cancelReject}>
                No
              </button>
              <button type="button" className="mr-btn-primary" onClick={confirmReject}>
                Yes, reject
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </>
  );
}
