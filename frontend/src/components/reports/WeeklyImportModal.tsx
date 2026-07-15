import { useEffect, useMemo, useState } from "react";
import type { ParsedWorkbook } from "../../lib/excel";
import {
  isRawUploadTabId,
  isValidWeekCode,
  isWeeklyUploadSheet,
  listImportableSheets,
  normalizeWeekCode,
  type RawUploadTabId,
} from "../../lib/weeklyImport";

type Props = {
  open: boolean;
  workbook: ParsedWorkbook | null;
  defaultWeek: string;
  /** When set, import only this raw source tab (per-tab upload). */
  lockedTabId: RawUploadTabId | null;
  onCancel: () => void;
  onConfirm: (week: string, selectedSheets: string[]) => void;
};

const RAW_TAB_LABELS: Record<RawUploadTabId, string> = {
  "aff-raw-upload": "Aff Raw",
  "player-raw-upload": "Player Raw",
  "system-comm-raw": "System Comm Raw",
  "aff-su": "Aff SU",
  "business-raw": "Business Raw",
};

function sheetMatchesLockedTab(
  item: ReturnType<typeof listImportableSheets>[number],
  lockedTabId: RawUploadTabId,
): boolean {
  return item.tabId === lockedTabId;
}

function defaultSelection(
  sheetOptions: ReturnType<typeof listImportableSheets>,
  lockedTabId: RawUploadTabId | null,
): string[] {
  if (lockedTabId) {
    const matched = sheetOptions.filter((item) => sheetMatchesLockedTab(item, lockedTabId));
    if (matched.length > 0) return matched.map((item) => item.sheetName);
    // BO single-sheet exports often use a generic sheet name — use the first sheet.
    if (sheetOptions.length === 1) return [sheetOptions[0]!.sheetName];
    return [];
  }

  return sheetOptions
    .filter((item) => item.recognized && isWeeklyUploadSheet(item.tabId))
    .map((item) => item.sheetName);
}

function isSelectableSheet(
  item: ReturnType<typeof listImportableSheets>[number],
  lockedTabId: RawUploadTabId | null,
): boolean {
  if (lockedTabId) {
    if (sheetMatchesLockedTab(item, lockedTabId)) return true;
    // Allow unrecognized sheets so a one-off BO export can still be mapped to this tab.
    if (!item.recognized) return true;
    return false;
  }
  return isWeeklyUploadSheet(item.tabId);
}

export function WeeklyImportModal({
  open,
  workbook,
  defaultWeek,
  lockedTabId,
  onCancel,
  onConfirm,
}: Props) {
  const [selectedWeek, setSelectedWeek] = useState(defaultWeek);
  const [selectedSheets, setSelectedSheets] = useState<string[]>([]);

  const sheetOptions = useMemo(
    () => (workbook ? listImportableSheets(workbook.sheetNames) : []),
    [workbook],
  );

  const weekValid = isValidWeekCode(selectedWeek);
  const normalizedWeek = weekValid ? normalizeWeekCode(selectedWeek) : selectedWeek.trim();
  const lockedLabel = lockedTabId ? RAW_TAB_LABELS[lockedTabId] : null;

  useEffect(() => {
    if (!open || !workbook) return;
    setSelectedWeek(defaultWeek);
    setSelectedSheets(defaultSelection(sheetOptions, lockedTabId));
  }, [open, workbook, defaultWeek, sheetOptions, lockedTabId]);

  function toggleSheet(sheetName: string) {
    const option = sheetOptions.find((item) => item.sheetName === sheetName);
    if (!option || !isSelectableSheet(option, lockedTabId)) return;

    setSelectedSheets((current) =>
      current.includes(sheetName)
        ? current.filter((name) => name !== sheetName)
        : [...current, sheetName],
    );
  }

  function selectDefaults() {
    setSelectedSheets(defaultSelection(sheetOptions, lockedTabId));
  }

  function clearAll() {
    setSelectedSheets([]);
  }

  function changeWeek(nextWeek: string) {
    setSelectedWeek(nextWeek);
  }

  function handleConfirm() {
    if (!weekValid || selectedSheets.length === 0) return;
    onConfirm(normalizeWeekCode(selectedWeek), selectedSheets);
  }

  if (!open || !workbook) return null;

  const selectableCount = sheetOptions.filter((item) =>
    isSelectableSheet(item, lockedTabId),
  ).length;

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
            <h2 id="weekly-import-title">
              {lockedLabel ? `${lockedLabel} upload` : "Raw source upload"}
            </h2>
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
            {lockedLabel
              ? `Upload ${lockedLabel}. All week codes in the file (e.g. 2026W25, 2026W26) are inserted and sorted per week. Week Detail / Paid Comm / Weekly Summary are recalculated for each week. Fallback week is used only when the sheet has no week column.`
              : "Upload Aff Raw, Player Raw, System Comm Raw, Aff SU, and/or Business Raw. All weeks found in Month/Week columns are imported (sorted). Weekly tabs are derived automatically."}
          </p>

          <label className="mr-modal-select">
            <span>Fallback week</span>
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
            ) : (
              <small className="mr-field-hint">
                Used when the file has no Month/Week codes. Multi-week files import every week
                found ({normalizedWeek} available as fallback).
              </small>
            )}
          </label>

          <div className="mr-sheet-actions">
            <button type="button" className="mr-btn-secondary" onClick={selectDefaults}>
              {lockedLabel ? `Select ${lockedLabel}` : "Select raw defaults"}
            </button>
            <button type="button" className="mr-btn-secondary" onClick={clearAll}>
              Clear
            </button>
          </div>

          <div className="mr-sheet-preview">
            <p>
              Sheets ({selectedSheets.length}/{selectableCount} selectable)
            </p>
            <ul className="mr-sheet-list">
              {sheetOptions.map((item) => {
                const checked = selectedSheets.includes(item.sheetName);
                const selectable = isSelectableSheet(item, lockedTabId);
                const isDefault =
                  lockedTabId != null
                    ? sheetMatchesLockedTab(item, lockedTabId) ||
                      (!item.recognized && sheetOptions.length === 1)
                    : item.recognized && isWeeklyUploadSheet(item.tabId);

                return (
                  <li key={item.sheetName}>
                    <label className={checked ? "active" : ""}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!selectable}
                        onChange={() => toggleSheet(item.sheetName)}
                      />
                      <span>
                        {item.sheetName}
                        {item.recognized ? (
                          <>
                            {" "}
                            →{" "}
                            <strong>
                              {isRawUploadTabId(item.tabId)
                                ? RAW_TAB_LABELS[item.tabId]
                                : item.tabId === "week-detail"
                                  ? "Week Detail (auto-computed)"
                                  : item.tabId === "weekly-summary"
                                    ? "Weekly Summary (auto-computed)"
                                    : item.tabId === "paid-comm"
                                      ? "Paid Comm (auto-computed)"
                                      : item.tabId}
                            </strong>
                            {isDefault && selectable ? <em> (upload)</em> : null}
                            {!selectable ? <em> (not uploaded)</em> : null}
                          </>
                        ) : lockedTabId && selectable ? (
                          <>
                            {" "}
                            → <strong>{RAW_TAB_LABELS[lockedTabId]}</strong>
                            <em> (map to this tab)</em>
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
