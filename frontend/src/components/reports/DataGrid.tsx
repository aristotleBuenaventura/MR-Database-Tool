import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type UIEvent,
} from "react";
import type { DataBarConfig } from "../../config/reports";
import type { CommissionProfile } from "../../lib/commissionSettings";
import { isMoneyDisplayColumn, periodCopy } from "../../config/reports";
import {
  formatMoneyDisplay,
  preciseFinalNetFromWeekDetailRow,
} from "../../lib/weeklyCompute";

type SortDir = "asc" | "desc";

export type RowViewMode = "scroll" | "20" | "50" | "100";

export function pageSizeForRowView(mode: RowViewMode): number | null {
  if (mode === "20") return 20;
  if (mode === "50") return 50;
  if (mode === "100") return 100;
  return null;
}

type Props = {
  /** Market id for brand-specific commission formulas (Week Detail FINAL NET tooltip). */
  marketId?: string | null;
  commissionProfile?: CommissionProfile | null;
  columns: string[];
  rows?: string[][];
  emptyRowCount?: number;
  rowHeight?: number;
  maxHeight?: number;
  /** Scroll = inner viewport. 20/50/100 = grow with rows; page scrolls. */
  rowViewMode?: RowViewMode;
  page?: number;
  onPageChange?: (page: number) => void;
  editableColumns?: Set<string>;
  /** Columns rendered as Paid/Unpaid/Reject status control when editable. */
  toggleColumns?: Set<string>;
  canEdit?: boolean;
  onCellCommit?: (rowIndex: number, column: string, value: string) => void;
  /** Enable checkbox column; indices are into the `rows` prop. */
  selectable?: boolean;
  selectedIndices?: Set<number>;
  onSelectionChange?: (indices: Set<number>) => void;
  /** Applied on mount / when columns change if nothing is saved in session. */
  defaultSortColumn?: string | null;
  defaultSortDir?: SortDir;
  /** sessionStorage key so sort survives refresh within this browser session. */
  sortPersistenceKey?: string | null;
  /** Excel-style data bars by column name (Business Raw). */
  dataBars?: Record<string, DataBarConfig> | null;
};

type DragSelectState = {
  active: boolean;
  paint: boolean;
  startVisual: number;
  baseSelection: Set<number>;
};

type PersistedSort = {
  column: string | null;
  dir: SortDir;
};

function readPersistedSort(
  key: string | null | undefined,
  columns: string[],
): PersistedSort | null {
  if (!key || typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { column?: unknown; dir?: unknown };
    const column =
      typeof parsed.column === "string" && columns.includes(parsed.column)
        ? parsed.column
        : parsed.column === null
          ? null
          : null;
    if (parsed.column != null && column == null) return null;
    const dir = parsed.dir === "desc" ? "desc" : "asc";
    return { column, dir };
  } catch {
    return null;
  }
}

function writePersistedSort(
  key: string | null | undefined,
  column: string | null,
  dir: SortDir,
): void {
  if (!key || typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(key, JSON.stringify({ column, dir }));
  } catch {
    // ignore quota / private mode errors
  }
}

function resolveInitialSort(
  columns: string[],
  persistenceKey: string | null | undefined,
  defaultSortColumn: string | null,
  defaultSortDir: SortDir,
): PersistedSort {
  const saved = readPersistedSort(persistenceKey, columns);
  if (
    saved?.column &&
    (columns.length === 0 || columns.includes(saved.column))
  ) {
    return saved;
  }
  // Prefer the tab default (e.g. Week Detail → Final Commission desc) whenever
  // there is no valid saved column — including when session had { column: null }.
  if (
    defaultSortColumn &&
    (columns.length === 0 || columns.includes(defaultSortColumn))
  ) {
    return { column: defaultSortColumn, dir: defaultSortDir };
  }
  return { column: null, dir: "asc" };
}

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

/** Draft values allowed while typing a number (empty, minus, one decimal, commas). */
function isNumericAmountDraft(text: string): boolean {
  const t = String(text ?? "").trim();
  if (!t || t === "-" || t === "." || t === "-.") return true;
  return /^-?\d*\.?\d*$/.test(t.replace(/,/g, ""));
}

function nextInputValue(
  input: HTMLInputElement,
  inserted: string,
): string {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  return `${input.value.slice(0, start)}${inserted}${input.value.slice(end)}`;
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

/** Display: whole numbers (Excel-style appearance). Underlying cell data keeps decimals. */
function formatWholeNumberDisplay(column: string, value: string): string {
  const text = String(value ?? "").trim();
  if (!text) return value;
  if (
    column === "Status" ||
    column === "Comm %" ||
    column === "SU MONTH" ||
    column.includes("Username") ||
    text.endsWith("%")
  ) {
    return value;
  }
  if (/^\d{4}W\d{2}$/i.test(text)) return value;
  // Non-numeric labels (usernames, etc.)
  if (!/^[\d,.\-+%()]+$/.test(text.replace(/\s/g, ""))) return value;

  const n = parseNumber(text);
  if (n == null) return value;
  return Math.round(n).toLocaleString("en-US");
}

function isMoneyColumn(column: string, allColumns: readonly string[]): boolean {
  return isMoneyDisplayColumn(column, allColumns);
}

/** True for numeric cells that are negative (supports commas, decimals, %, and (123) style). */
function isNegativeNumeric(value: unknown): boolean {
  const n = parseNumber(String(value ?? ""));
  return n != null && n < 0;
}

type DataBarScale = {
  mode: "positive" | "diverging";
  maxAbs: number;
};

function buildDataBarScales(
  columns: string[],
  rows: string[][],
  dataBars: Record<string, DataBarConfig> | null | undefined,
): Map<string, DataBarScale> {
  const scales = new Map<string, DataBarScale>();
  if (!dataBars || rows.length === 0) return scales;

  for (const [column, config] of Object.entries(dataBars)) {
    const colIndex = columns.indexOf(column);
    if (colIndex < 0) continue;

    let maxAbs = 0;
    for (const row of rows) {
      const n = parseNumber(String(row[colIndex] ?? ""));
      if (n == null) continue;
      const abs = Math.abs(n);
      if (abs > maxAbs) maxAbs = abs;
    }
    if (maxAbs <= 0) continue;
    scales.set(column, { mode: config.mode, maxAbs });
  }
  return scales;
}

function dataBarCellStyle(
  config: DataBarConfig,
  scale: DataBarScale,
  value: string,
): CSSProperties | undefined {
  const n = parseNumber(value);
  if (n == null || scale.maxAbs <= 0) return undefined;

  if (config.mode === "diverging") {
    const pct = Math.min(50, (Math.abs(n) / scale.maxAbs) * 50);
    const pos = n >= 0 ? pct : 0;
    const neg = n < 0 ? pct : 0;
    return {
      ["--bar-pos" as string]: `${pos}%`,
      ["--bar-neg" as string]: `${neg}%`,
    } as CSSProperties;
  }

  const pct = Math.min(100, (Math.max(0, n) / scale.maxAbs) * 100);
  return {
    ["--bar-pct" as string]: `${pct}%`,
  } as CSSProperties;
}

const EMPTY_SELECTION = new Set<number>();

export function DataGrid({
  marketId,
  commissionProfile,
  columns,
  rows = [],
  emptyRowCount = 16,
  rowHeight = 34,
  maxHeight = 560,
  rowViewMode = "scroll",
  page = 1,
  onPageChange,
  editableColumns,
  toggleColumns,
  canEdit = false,
  onCellCommit,
  selectable = false,
  selectedIndices,
  onSelectionChange,
  defaultSortColumn = null,
  defaultSortDir = "asc",
  sortPersistenceKey = null,
  dataBars = null,
}: Props) {
  const words = periodCopy(marketId);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragSelectState | null>(null);
  const displayEntriesRef = useRef<{ row: string[]; index: number }[]>([]);
  const selectedRef = useRef<Set<number>>(EMPTY_SELECTION);
  const anchorVisualRef = useRef<number | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [hoverTip, setHoverTip] = useState<{
    text: string;
    x: number;
    y: number;
  } | null>(null);
  const [sortColumn, setSortColumn] = useState<string | null>(() =>
    resolveInitialSort(columns, sortPersistenceKey, defaultSortColumn, defaultSortDir)
      .column,
  );
  const [sortDir, setSortDir] = useState<SortDir>(() =>
    resolveInitialSort(columns, sortPersistenceKey, defaultSortColumn, defaultSortDir).dir,
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

  // Keep default sort applied whenever local sort is empty/invalid (e.g. Week Detail
  // Final Commission desc on first open). Don't re-read sessionStorage into activeSort.
  if (columns.length > 0) {
    const columnInvalid = sortColumn != null && !columns.includes(sortColumn);
    const needsDefault =
      (sortColumn == null || columnInvalid) &&
      Boolean(defaultSortColumn) &&
      columns.includes(defaultSortColumn!);

    if (needsDefault) {
      if (sortColumn !== defaultSortColumn || sortDir !== defaultSortDir) {
        setSortColumn(defaultSortColumn!);
        setSortDir(defaultSortDir);
      }
    } else if (columnInvalid) {
      setSortColumn(null);
      setSortDir("asc");
    }
  }

  const activeSort = useMemo(
    () => ({
      column: sortColumn && columns.includes(sortColumn) ? sortColumn : null,
      dir: sortDir,
    }),
    [sortColumn, sortDir, columns],
  );

  useEffect(() => {
    // Persist the effective sort; never write a null column when a default exists
    // (that used to wipe Week Detail's Final Commission default on reload).
    const columnToSave =
      activeSort.column ??
      (defaultSortColumn && columns.includes(defaultSortColumn)
        ? defaultSortColumn
        : null);
    const dirToSave =
      activeSort.column != null
        ? activeSort.dir
        : defaultSortColumn && columns.includes(defaultSortColumn)
          ? defaultSortDir
          : activeSort.dir;
    writePersistedSort(sortPersistenceKey, columnToSave, dirToSave);
  }, [
    sortPersistenceKey,
    activeSort.column,
    activeSort.dir,
    defaultSortColumn,
    defaultSortDir,
    columns,
  ]);

  const sortedEntries = useMemo(() => {
    const entries = rows.map((row, index) => ({ row, index }));
    if (!activeSort.column || rows.length === 0) return entries;

    const colIndex = columns.indexOf(activeSort.column);
    if (colIndex < 0) return entries;

    const direction = activeSort.dir === "asc" ? 1 : -1;
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
  }, [rows, columns, activeSort.column, activeSort.dir]);

  const dataBarScales = useMemo(
    () => buildDataBarScales(columns, rows, dataBars),
    [columns, rows, dataBars],
  );

  const displayEntries = useMemo(() => {
    if (rows.length > 0) return sortedEntries;
    return Array.from({ length: emptyRowCount }, (_, index) => ({
      row: Array.from({ length: columns.length }, () => ""),
      index,
    }));
  }, [rows.length, sortedEntries, emptyRowCount, columns.length]);

  displayEntriesRef.current = displayEntries;

  const constrainViewport = rowViewMode === "scroll";
  const pageSize = pageSizeForRowView(rowViewMode);
  const totalPages = pageSize
    ? Math.max(1, Math.ceil(displayEntries.length / pageSize))
    : 1;
  const safePage = Math.min(Math.max(1, page), totalPages);
  const pageStart = pageSize ? (safePage - 1) * pageSize : 0;
  const pageEntries = pageSize
    ? displayEntries.slice(pageStart, pageStart + pageSize)
    : displayEntries;

  useEffect(() => {
    if (page !== safePage) onPageChange?.(safePage);
  }, [page, safePage, onPageChange]);

  useEffect(() => {
    setScrollTop(0);
    if (scrollerRef.current) scrollerRef.current.scrollTop = 0;
    if (rowViewMode !== "scroll") {
      scrollerRef.current?.scrollIntoView({ block: "start" });
    }
  }, [page, rowViewMode]);

  const isVirtual = constrainViewport && pageEntries.length > 80;
  const overscan = 12;
  const visibleCount = Math.ceil(maxHeight / rowHeight) + overscan * 2;
  const startIndex = isVirtual
    ? Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
    : 0;
  const endIndex = isVirtual
    ? Math.min(pageEntries.length, startIndex + visibleCount)
    : pageEntries.length;
  const slice = pageEntries.slice(startIndex, endIndex);
  const topPad = startIndex * rowHeight;
  const bottomPad = (pageEntries.length - endIndex) * rowHeight;

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
    setHoverTip(null);
    if (!isVirtual && !isDragSelecting) return;
    setScrollTop(event.currentTarget.scrollTop);
  }

  function toggleSort(column: string) {
    if (rows.length === 0) return;

    // Cycle: new column → asc → desc → asc (never "clear" into a stuck fallback).
    if (sortColumn !== column) {
      setSortColumn(column);
      setSortDir("asc");
    } else if (sortDir === "asc") {
      setSortDir("desc");
    } else {
      setSortDir("asc");
    }

    setScrollTop(0);
    anchorVisualRef.current = null;
    if (scrollerRef.current) scrollerRef.current.scrollTop = 0;
    if (pageSize && safePage !== 1) onPageChange?.(1);
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
        className={`mr-grid-wrap${isDragSelecting ? " is-drag-selecting" : ""}${
          constrainViewport ? "" : " is-unconstrained"
        }`}
        ref={scrollerRef}
        onScroll={onScroll}
        style={constrainViewport ? { maxHeight } : undefined}
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
                const active = activeSort.column === column;
                const ariaSort = !active
                  ? "none"
                  : activeSort.dir === "asc"
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
                            ? activeSort.dir === "asc"
                              ? "Sorted ascending — click for descending"
                              : "Sorted descending — click for ascending"
                            : "Sort ascending"
                      }
                    >
                      <span className="mr-sort-label">{column}</span>
                      <span className="mr-sort-indicator" aria-hidden="true">
                        {active ? (activeSort.dir === "asc" ? "▲" : "▼") : "⇅"}
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
              const visualIndex = pageStart + startIndex + index;
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
                    const barConfig = dataBars?.[column];
                    const barScale = dataBarScales.get(column);
                    const barStyle =
                      barConfig && barScale
                        ? dataBarCellStyle(barConfig, barScale, value)
                        : undefined;
                    const barTint =
                      barConfig?.tintText === "always-red"
                        ? "mr-cell-bar-tint-red"
                        : barConfig?.tintText === "signed" && negative
                          ? "mr-cell-negative"
                          : barConfig?.tintText === "signed"
                            ? "mr-cell-bar-tint-green"
                            : "";
                    const barClass =
                      barConfig && barStyle
                        ? `mr-data-bar mr-data-bar-${barConfig.variant}${
                            barConfig.mode === "diverging" ? " is-diverging" : ""
                          }`
                        : "";
                    const cellNum = parseNumber(value);
                    const finalNetPreciseLabel =
                      column === "FINAL NET" && rows.length > 0
                        ? formatMoneyDisplay(
                            preciseFinalNetFromWeekDetailRow(
                              row,
                              columns,
                              marketId,
                              commissionProfile,
                            ),
                          )
                        : null;
                    const moneyUnderlying =
                      isMoneyColumn(column, columns) && !isToggle && cellNum != null
                        ? formatMoneyDisplay(cellNum)
                        : null;
                    const preciseTip =
                      finalNetPreciseLabel ??
                      (moneyUnderlying &&
                      cellNum != null &&
                      Math.abs(cellNum - Math.round(cellNum)) > 1e-9
                        ? moneyUnderlying
                        : null);
                    const editInputValue =
                      editable && isMoneyColumn(column, columns) && cellNum != null
                        ? formatMoneyDisplay(cellNum)
                        : displayValue;

                    return (
                      <td
                        key={column}
                        className={[
                          editable ? "mr-cell-editable" : "",
                          !barTint && negative ? "mr-cell-negative" : "",
                          column === "Final Commission" ? "mr-cell-bold" : "",
                          preciseTip ? "mr-final-net-cell" : "",
                          barTint,
                          barClass,
                        ]
                          .filter(Boolean)
                          .join(" ") || undefined}
                        style={barStyle}
                        onMouseEnter={
                          preciseTip
                            ? (event) => {
                                const rect = (
                                  event.currentTarget as HTMLElement
                                ).getBoundingClientRect();
                                setHoverTip({
                                  text: `Actual: ${preciseTip}`,
                                  x: rect.left + rect.width / 2,
                                  y: rect.top,
                                });
                              }
                            : undefined
                        }
                        onMouseLeave={
                          preciseTip ? () => setHoverTip(null) : undefined
                        }
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
                            // Thousand separators for display (e.g. Last Week NCF);
                            // blur still parses commas / (n) via parseNumber.
                            defaultValue={editInputValue}
                            key={`${sourceIndex}-${column}-${value}`}
                            inputMode={
                              column === "Adjustment" ? "decimal" : undefined
                            }
                            autoComplete="off"
                            spellCheck={column === "Adjustment" ? false : undefined}
                            onBeforeInput={
                              column === "Adjustment"
                                ? (event) => {
                                    if (!event.data) return;
                                    const target = event.currentTarget;
                                    const next = nextInputValue(target, event.data);
                                    if (!isNumericAmountDraft(next)) {
                                      event.preventDefault();
                                    }
                                  }
                                : undefined
                            }
                            onPaste={
                              column === "Adjustment"
                                ? (event) => {
                                    const pasted =
                                      event.clipboardData.getData("text") ?? "";
                                    const target = event.currentTarget;
                                    const next = nextInputValue(target, pasted);
                                    if (!isNumericAmountDraft(next)) {
                                      event.preventDefault();
                                    }
                                  }
                                : undefined
                            }
                            onBlur={(event) => {
                              const typed = event.target.value.trim();
                              const nextNum = parseNumber(typed);
                              const prevNum = parseNumber(String(value ?? ""));
                              if (column === "Adjustment") {
                                if (typed !== "" && nextNum == null) {
                                  event.currentTarget.value = String(
                                    editInputValue ?? "",
                                  );
                                  return;
                                }
                              }
                              // Skip only when the numeric amount is unchanged
                              // (ignore comma / formatting-only edits).
                              if (
                                nextNum != null &&
                                prevNum != null &&
                                nextNum === prevNum
                              ) {
                                return;
                              }
                              if (typed === String(value ?? "").trim()) return;
                              if (typed === String(displayValue ?? "").trim()) return;
                              if (typed === String(editInputValue ?? "").trim()) return;
                              const normalized =
                                column === "Adjustment"
                                  ? typed === ""
                                    ? ""
                                    : String(nextNum)
                                  : nextNum != null
                                    ? String(nextNum)
                                    : typed;
                              onCellCommit?.(sourceIndex, column, normalized);
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                (event.target as HTMLInputElement).blur();
                                return;
                              }
                              if (column !== "Adjustment") return;
                              if (event.metaKey || event.ctrlKey || event.altKey) {
                                return;
                              }
                              if (event.key.length !== 1) return;
                              const next = nextInputValue(
                                event.currentTarget,
                                event.key,
                              );
                              if (!isNumericAmountDraft(next)) {
                                event.preventDefault();
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
                          <span className="mr-data-bar-label">{displayValue}</span>
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
                ? This will delete the row from {words.detail}.
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

      {hoverTip ? (
        <div
          className="mr-final-net-tip"
          role="tooltip"
          style={{
            left: hoverTip.x,
            top: hoverTip.y,
          }}
        >
          {hoverTip.text}
        </div>
      ) : null}
    </>
  );
}
