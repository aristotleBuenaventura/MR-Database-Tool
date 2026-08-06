import { REPORT_TABS, type ReportTabId } from "../../config/reports";

type Props = {
  week: string;
  weekOptions?: string[];
  onWeekChange: (week: string) => void;
  activeTab: ReportTabId;
  onTabChange: (tab: ReportTabId) => void;
};

export function ReportsTopBar({
  week,
  weekOptions = [],
  onWeekChange,
  activeTab,
  onTabChange,
}: Props) {
  // Only show weeks that belong to the current brand.
  // If the selected week is missing (loading / empty brand), keep a temporary option.
  const options =
    !week || weekOptions.includes(week) ? weekOptions : [week, ...weekOptions];

  return (
    <div className="mr-topbar">
      <div className="mr-topbar-inner">
        <label className="mr-week-select">
          <span className="mr-week-label">Week</span>
          <select
            value={week}
            onChange={(e) => onWeekChange(e.target.value)}
            disabled={options.length === 0}
          >
            {options.length === 0 ? (
              <option value="">No weeks</option>
            ) : (
              options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))
            )}
          </select>
        </label>

        <div className="mr-tabs" role="tablist" aria-label="Report tables">
          {REPORT_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              className={activeTab === tab.id ? "active" : ""}
              onClick={() => onTabChange(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
