import { REPORT_TABS, periodCopy, reportTabsForMarket, type ReportTabId } from "../../config/reports";

type Props = {
  week: string;
  weekOptions?: string[];
  onWeekChange: (week: string) => void;
  activeTab: ReportTabId;
  onTabChange: (tab: ReportTabId) => void;
  marketId?: string;
  /** SUMMARY sidebar shortcut: only Weekly Summary tab is available. */
  summaryLocked?: boolean;
};

export function ReportsTopBar({
  week,
  weekOptions = [],
  onWeekChange,
  activeTab,
  onTabChange,
  marketId,
  summaryLocked = false,
}: Props) {
  const allTabs = marketId ? reportTabsForMarket(marketId) : REPORT_TABS;
  const tabs = summaryLocked
    ? allTabs.filter((tab) => tab.id === "weekly-summary")
    : allTabs;
  const words = periodCopy(marketId);
  // Only weeks returned for this brand. A leftover selection from another
  // brand, or a week that was deleted, is not added back into the list.
  const options = weekOptions;
  const selected = week && options.includes(week) ? week : "";

  return (
    <div className="mr-topbar">
      <div className="mr-topbar-inner">
        <label className="mr-week-select">
          <span className="mr-week-label">{words.Week}</span>
          <select
            value={selected}
            onChange={(e) => onWeekChange(e.target.value)}
            disabled={options.length === 0}
          >
            {options.length === 0 ? (
              <option value="">No {words.weeks}</option>
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
          {tabs.map((tab) => (
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
