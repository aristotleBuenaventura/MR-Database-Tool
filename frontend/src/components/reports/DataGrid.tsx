import { useMemo, useRef, useState, type UIEvent } from "react";

type Props = {
  columns: string[];
  rows?: string[][];
  emptyRowCount?: number;
  rowHeight?: number;
  maxHeight?: number;
};

export function DataGrid({
  columns,
  rows = [],
  emptyRowCount = 16,
  rowHeight = 34,
  maxHeight = 560,
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
              <th key={column}>{column}</th>
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
                {columns.map((_, colIndex) => (
                  <td key={colIndex}>{row[colIndex] ?? ""}</td>
                ))}
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
