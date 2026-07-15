type Props = {
  canExport: boolean;
  onExport?: () => void;
};

export function ExportButton({ canExport, onExport }: Props) {
  if (!canExport) return null;

  return (
    <button
      type="button"
      className="mr-export-btn"
      onClick={onExport}
      disabled={!onExport}
      title={onExport ? "Download this table as CSV" : "No rows to export"}
    >
      Export CSV
    </button>
  );
}
