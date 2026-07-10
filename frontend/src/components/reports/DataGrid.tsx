type Props = {
  columns: string[];
  rows?: string[][];
  emptyRowCount?: number;
};

export function DataGrid({ columns, rows = [], emptyRowCount = 16 }: Props) {
  const displayRows =
    rows.length > 0
      ? rows
      : Array.from({ length: emptyRowCount }, () => Array.from({ length: columns.length }, () => ""));

  return (
    <div className="mr-grid-wrap">
      <table className="mr-grid">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {displayRows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {columns.map((_, colIndex) => (
                <td key={colIndex}>{row[colIndex] ?? ""}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
