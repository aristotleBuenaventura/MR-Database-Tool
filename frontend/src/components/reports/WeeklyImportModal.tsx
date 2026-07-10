import { useEffect, useMemo, useState } from "react";
import type { ParsedWorkbook } from "../../lib/excel";
import { listImportableSheets, listWeekSheets } from "../../lib/weeklyImport";

type Props = {
  open: boolean;
  workbook: ParsedWorkbook | null;
  defaultWeek: string;
  onCancel: () => void;
  onConfirm: (week: string, selectedSheets: string[]) => void;
};

export function WeeklyImportModal({
  open,
  workbook,
  defaultWeek,
  onCancel,
  onConfirm,
}: Props) {
  const [selectedWeek, setSelectedWeek] = useState(defaultWeek);
  const [selectedSheets, setSelectedSheets] = useState<string[]>([]);

  const weekSheets = useMemo(
    () => (workbook ? listWeekSheets(workbook.sheetNames) : []),
    [workbook],
  );

  const sheetOptions = useMemo(
    () => (workbook ? listImportableSheets(workbook.sheetNames) : []),
    [workbook],
  );

  useEffect(() => {
    if (!open || !workbook) return;

    if (weekSheets.includes(defaultWeek)) {
      setSelectedWeek(defaultWeek);
    } else if (weekSheets[0]) {
      setSelectedWeek(weekSheets[0]);
    } else {
      setSelectedWeek(defaultWeek);
    }

    // Start with nothing selected — user chooses sheets manually.
    setSelectedSheets([]);
  }, [open, workbook, defaultWeek, weekSheets]);

  function toggleSheet(sheetName: string) {
    setSelectedSheets((current) =>
      current.includes(sheetName)
        ? current.filter((name) => name !== sheetName)
        : [...current, sheetName],
    );
  }

  function selectRecognized() {
    setSelectedSheets(
      sheetOptions
        .filter((item) => {
          if (!item.recognized) return false;
          if (/^\d{4}W\d{2}$/i.test(item.sheetName)) {
            return item.sheetName.toUpperCase() === selectedWeek.toUpperCase();
          }
          return item.tabId !== "weekly-summary";
        })
        .map((item) => item.sheetName),
    );
  }

  function selectAll() {
    setSelectedSheets(sheetOptions.map((item) => item.sheetName));
  }

  function clearAll() {
    setSelectedSheets([]);
  }

  if (!open || !workbook) return null;

  return (
    <div className="mr-modal-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="mr-modal mr-modal-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="weekly-import-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="mr-modal-header">
          <div>
            <h2 id="weekly-import-title">Weekly workbook import</h2>
            <p>
              File: <strong>{workbook.fileName}</strong>
            </p>
          </div>
          <button type="button" className="mr-modal-close" onClick={onCancel} aria-label="Close">
            ×
          </button>
        </header>

        <div className="mr-modal-body">
          <p className="mr-modal-hint">
            Choose the target week, then manually select which sheets to import. Nothing is
            pre-selected.
          </p>

          <label className="mr-modal-select">
            <span>Target week</span>
            <select
              value={selectedWeek}
              onChange={(e) => setSelectedWeek(e.target.value)}
            >
              {weekSheets.length > 0
                ? weekSheets.map((week) => (
                    <option key={week} value={week}>
                      {week}
                    </option>
                  ))
                : [defaultWeek].map((week) => (
                    <option key={week} value={week}>
                      {week}
                    </option>
                  ))}
            </select>
          </label>

          <div className="mr-sheet-actions">
            <button type="button" className="mr-btn-secondary" onClick={selectRecognized}>
              Select recognized
            </button>
            <button type="button" className="mr-btn-secondary" onClick={selectAll}>
              Select all
            </button>
            <button type="button" className="mr-btn-secondary" onClick={clearAll}>
              Clear
            </button>
          </div>

          <div className="mr-sheet-preview">
            <p>
              Sheets ({selectedSheets.length}/{sheetOptions.length} selected)
            </p>
            <ul className="mr-sheet-list">
              {sheetOptions.map((item) => {
                const checked = selectedSheets.includes(item.sheetName);
                return (
                  <li key={item.sheetName}>
                    <label className={checked ? "active" : ""}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSheet(item.sheetName)}
                      />
                      <span>
                        {item.sheetName}
                        {item.recognized ? (
                          <>
                            {" "}
                            →{" "}
                            <strong>
                              {item.tabId === "week-detail"
                                ? item.sheetName
                                : item.tabId === "weekly-summary"
                                  ? "Weekly Summary"
                                  : item.tabId}
                            </strong>
                          </>
                        ) : (
                          <em> (unrecognized)</em>
                        )}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

        <footer className="mr-modal-footer">
          <button type="button" className="mr-btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="mr-btn-primary"
            disabled={!selectedWeek || selectedSheets.length === 0}
            onClick={() => onConfirm(selectedWeek, selectedSheets)}
          >
            Import selected
          </button>
        </footer>
      </div>
    </div>
  );
}
