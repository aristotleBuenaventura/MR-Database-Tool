import { REPORT_TABS, WEEK_OPTIONS, type ReportTabId } from "../../config/reports";

type Props = {
  week: string;
  onWeekChange: (week: string) => void;
  activeTab: ReportTabId;
  onTabChange: (tab: ReportTabId) => void;
};

export function ReportsTopBar({ week, onWeekChange, activeTab, onTabChange }: Props) {
  return (
    <div className="mr-topbar">
      <label className="mr-week-select">
        <span className="sr-only">Week</span>
        <select value={week} onChange={(e) => onWeekChange(e.target.value)}>
          {WEEK_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>

      <div className="mr-tabs" role="tablist">
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
  );
}
