import { useEffect, useMemo, useState } from "react";
import { getSheetHeaders, type ParsedWorkbook } from "../../lib/excel";

type CategoryOption = {
  id: string;
  label: string;
};

type Props = {
  open: boolean;
  workbook: ParsedWorkbook | null;
  targetLabel: string;
  categories?: CategoryOption[];
  onCancel: () => void;
  onConfirm: (sheetName: string, categoryId?: string) => void;
};

export function SheetPickerModal({
  open,
  workbook,
  targetLabel,
  categories,
  onCancel,
  onConfirm,
}: Props) {
  const [selectedSheet, setSelectedSheet] = useState("");
  const [selectedCategory, setSelectedCategory] = useState(categories?.[0]?.id ?? "");

  useEffect(() => {
    if (!open || !workbook) {
      setSelectedSheet("");
      return;
    }
    setSelectedSheet(workbook.sheetNames[0] ?? "");
    setSelectedCategory(categories?.[0]?.id ?? "");
  }, [open, workbook, categories]);

  const previewHeaders = useMemo(() => {
    if (!workbook || !selectedSheet) return [];
    return getSheetHeaders(workbook.workbook, selectedSheet).slice(0, 12);
  }, [workbook, selectedSheet]);

  if (!open || !workbook) return null;

  return (
    <div className="mr-modal-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="mr-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sheet-picker-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="mr-modal-header">
          <div>
            <h2 id="sheet-picker-title">Select sheet</h2>
            <p>
              File: <strong>{workbook.fileName}</strong>
            </p>
            <p>
              Load into: <strong>{targetLabel}</strong>
            </p>
          </div>
          <button type="button" className="mr-modal-close" onClick={onCancel} aria-label="Close">
            ×
          </button>
        </header>

        <div className="mr-modal-body">
          <p className="mr-modal-hint">Choose which sheet to import from this workbook.</p>
          <ul className="mr-sheet-list">
            {workbook.sheetNames.map((sheetName) => (
              <li key={sheetName}>
                <label className={selectedSheet === sheetName ? "active" : ""}>
                  <input
                    type="radio"
                    name="sheet"
                    value={sheetName}
                    checked={selectedSheet === sheetName}
                    onChange={() => setSelectedSheet(sheetName)}
                  />
                  <span>{sheetName}</span>
                </label>
              </li>
            ))}
          </ul>

          {categories && categories.length > 0 ? (
            <label className="mr-modal-select">
              <span>Target category</span>
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
              >
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {previewHeaders.length > 0 ? (
            <div className="mr-sheet-preview">
              <p>Header preview</p>
              <div className="mr-sheet-preview-tags">
                {previewHeaders.map((header) => (
                  <span key={header}>{header}</span>
                ))}
              </div>
            </div>
          ) : (
            <p className="mr-readonly-note">Selected sheet has no header row.</p>
          )}
        </div>

        <footer className="mr-modal-footer">
          <button type="button" className="mr-btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="mr-btn-primary"
            disabled={!selectedSheet}
            onClick={() => onConfirm(selectedSheet, selectedCategory || undefined)}
          >
            Import sheet
          </button>
        </footer>
      </div>
    </div>
  );
}
