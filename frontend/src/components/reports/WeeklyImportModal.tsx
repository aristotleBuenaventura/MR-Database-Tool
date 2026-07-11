import { useEffect, useMemo, useState } from "react";
import type { ParsedWorkbook } from "../../lib/excel";
import {
  isValidWeekCode,
  isWeeklyUploadSheet,
  listImportableSheets,
  listWeekSheets,
  normalizeWeekCode,
} from "../../lib/weeklyImport";

type Props = {
  open: boolean;
  workbook: ParsedWorkbook | null;
  defaultWeek: string;
  onCancel: () => void;
  onConfirm: (week: string, selectedSheets: string[]) => void;
};

function defaultWeeklySelection(
  sheetOptions: ReturnType<typeof listImportableSheets>,
  targetWeek: string,
): string[] {
  return sheetOptions
    .filter(
      (item) =>
        item.recognized && isWeeklyUploadSheet(item.tabId, item.sheetName, targetWeek),
    )
    .map((item) => item.sheetName);
}

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

  const weekValid = isValidWeekCode(selectedWeek);
  const normalizedWeek = weekValid ? normalizeWeekCode(selectedWeek) : selectedWeek.trim();

  useEffect(() => {
    if (!open || !workbook) return;

    const initialWeek = weekSheets.includes(defaultWeek)
      ? defaultWeek
      : (weekSheets[0] ?? defaultWeek);

    setSelectedWeek(initialWeek);
    setSelectedSheets(defaultWeeklySelection(sheetOptions, initialWeek));
  }, [open, workbook, defaultWeek, weekSheets, sheetOptions]);

  function toggleSheet(sheetName: string) {
    setSelectedSheets((current) =>
      current.includes(sheetName)
        ? current.filter((name) => name !== sheetName)
        : [...current, sheetName],
    );
  }

  function selectWeeklyDefaults() {
    const week = isValidWeekCode(selectedWeek)
      ? normalizeWeekCode(selectedWeek)
      : selectedWeek.trim();
    setSelectedSheets(defaultWeeklySelection(sheetOptions, week));
  }

  function selectAll() {
    setSelectedSheets(sheetOptions.map((item) => item.sheetName));
  }

  function clearAll() {
    setSelectedSheets([]);
  }

  function changeWeek(nextWeek: string) {
    setSelectedWeek(nextWeek);
    const normalized = isValidWeekCode(nextWeek)
      ? normalizeWeekCode(nextWeek)
      : nextWeek.trim();

    setSelectedSheets((current) => {
      const withoutWeekSheets = current.filter((name) => !/^\d{4}W\d{2}$/i.test(name));
      const weekSheet = sheetOptions.find(
        (item) =>
          item.tabId === "week-detail" &&
          item.sheetName.toUpperCase() === normalized.toUpperCase(),
      );
      return weekSheet ? [...withoutWeekSheets, weekSheet.sheetName] : withoutWeekSheets;
    });
  }

  function handleConfirm() {
    if (!weekValid || selectedSheets.length === 0) return;
    onConfirm(normalizeWeekCode(selectedWeek), selectedSheets);
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
            Type a target week for new weeks (e.g. 2026W28). Pre-selected: matching week sheet + Aff
            RawW, Player RawW, System Comm Raw, Aff SU, and Business Raw. Paid Comm and Weekly
            Summary stay off (derived by the app).
          </p>

          <label className="mr-modal-select">
            <span>Target week</span>
            <input
              type="text"
              value={selectedWeek}
              placeholder="e.g. 2026W28"
              spellCheck={false}
              autoCapitalize="characters"
              onChange={(e) => changeWeek(e.target.value)}
              onBlur={() => {
                if (isValidWeekCode(selectedWeek)) {
                  changeWeek(normalizeWeekCode(selectedWeek));
                }
              }}
            />
            {!selectedWeek.trim() ? (
              <small className="mr-field-hint">Enter a week code like 2026W28.</small>
            ) : !weekValid ? (
              <small className="mr-field-hint mr-field-hint-error">
                Use format YYYYWww (example: 2026W28).
              </small>
            ) : weekSheets.some(
                (week) => week.toUpperCase() === normalizedWeek.toUpperCase(),
              ) ? (
              <small className="mr-field-hint">
                Week sheet found in workbook: {normalizedWeek}
              </small>
            ) : (
              <small className="mr-field-hint">
                New week {normalizedWeek} — import sources (and week sheet if present).
              </small>
            )}
          </label>

          <div className="mr-sheet-actions">
            <button type="button" className="mr-btn-secondary" onClick={selectWeeklyDefaults}>
              Select weekly defaults
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
                const isDefault =
                  item.recognized &&
                  isWeeklyUploadSheet(item.tabId, item.sheetName, normalizedWeek);
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
                            {isDefault ? <em> (weekly default)</em> : null}
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
            disabled={!weekValid || selectedSheets.length === 0}
            onClick={handleConfirm}
          >
            Import selected
          </button>
        </footer>
      </div>
    </div>
  );
}
