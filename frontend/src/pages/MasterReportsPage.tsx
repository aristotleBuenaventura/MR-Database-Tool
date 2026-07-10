import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import {
  REPORT_TABS,
  TAB_COLUMNS,
  WEEKLY_MARKETS,
  type Market,
  type ReportTabId,
} from "../config/reports";
import { AffiliateFilter } from "../components/reports/AffiliateFilter";
import { DataGrid } from "../components/reports/DataGrid";
import { DatabaseTab } from "../components/reports/DatabaseTab";
import { ExportButton } from "../components/reports/ExportButton";
import { ReportsSidebar } from "../components/reports/ReportsSidebar";
import { ReportsTopBar } from "../components/reports/ReportsTopBar";
import { UploadPanel } from "../components/reports/UploadPanel";

const UPLOAD_TABS: ReportTabId[] = [
  "paid-comm",
  "system-comm-raw",
  "aff-raw-upload",
  "player-raw-upload",
  "business-raw",
  "aff-su",
];

const FILTER_PRESETS: Partial<
  Record<ReportTabId, { id: string; label: string }[]>
> = {
  "weekly-summary": [
    { id: "affiliateUsername", label: "Affiliate Username" },
    { id: "uplineAffiliateUsername", label: "Upline Affiliate Username" },
  ],
  "paid-comm": [
    { id: "affiliateUsername", label: "Affiliate Username" },
    { id: "week", label: "Week" },
  ],
  "system-comm-raw": [
    { id: "affiliateUsername", label: "Affiliate Username" },
    { id: "week", label: "Week" },
  ],
  "aff-raw-upload": [
    { id: "affiliateUsername", label: "Affiliate Username" },
    { id: "week", label: "Week" },
  ],
  "player-raw-upload": [
    { id: "affiliateUsername", label: "Affiliate Username" },
    { id: "week", label: "Week" },
  ],
};

export function MasterReportsPage() {
  const navigate = useNavigate();
  const { user, capabilities, logout } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [market, setMarket] = useState<Market>(WEEKLY_MARKETS[8]!); // TK BDT
  const [week, setWeek] = useState("2026W26");
  const [activeTab, setActiveTab] = useState<ReportTabId>("weekly-summary");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [uploadName, setUploadName] = useState("");
  const [dbFileName, setDbFileName] = useState("");
  const [dbLocation, setDbLocation] = useState("");

  const canImportExport = Boolean(capabilities?.canImportExport);
  const tabMeta = REPORT_TABS.find((tab) => tab.id === activeTab);
  const filterFields = FILTER_PRESETS[activeTab] ?? [];

  const sectionTitle = useMemo(() => {
    if (activeTab === "weekly-summary") return "Weekly Summary";
    if (activeTab === "paid-comm") return "PAID COMM";
    if (activeTab === "system-comm-raw") return "SYSTEM COMM";
    if (activeTab === "aff-raw-upload") return "AFF RAW";
    if (activeTab === "player-raw-upload") return "PLAYER RAW";
    if (activeTab === "business-raw") return "BUSINESS RAW";
    if (activeTab === "aff-su") return "AFF SU";
    return tabMeta?.label ?? "";
  }, [activeTab, tabMeta]);

  function handleLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  if (!user) return null;

  return (
    <div className={`mr-shell ${collapsed ? "sidebar-collapsed" : ""}`}>
      <ReportsSidebar
        activeMarketId={market.id}
        onSelectMarket={setMarket}
        collapsed={collapsed}
        onToggle={() => setCollapsed((value) => !value)}
        userLabel={user.name ?? user.email}
        role={user.role}
        onLogout={handleLogout}
      />

      <div className="mr-main">
        <ReportsTopBar
          week={week}
          onWeekChange={setWeek}
          activeTab={activeTab}
          onTabChange={(tab) => {
            setActiveTab(tab);
            setUploadName("");
            setFilters({});
          }}
        />

        <div className="mr-content">
          {activeTab === "database" ? (
            <DatabaseTab
              canImportExport={canImportExport}
              fileName={dbFileName}
              location={dbLocation}
              onFileNameChange={setDbFileName}
              onLocationChange={setDbLocation}
              onFileSelect={() => undefined}
            />
          ) : (
            <>
              <div className="mr-toolbar">
                {UPLOAD_TABS.includes(activeTab) ? (
                  <UploadPanel
                    title={`${tabMeta?.label.toUpperCase() ?? "UPLOAD"}`}
                    canUpload={canImportExport}
                    fileName={uploadName}
                    onFileNameChange={setUploadName}
                  />
                ) : null}

                {filterFields.length > 0 ? (
                  <AffiliateFilter
                    fields={filterFields}
                    values={filters}
                    onChange={(id, value) =>
                      setFilters((current) => ({ ...current, [id]: value }))
                    }
                  />
                ) : null}
              </div>

              <div className="mr-section-bar">
                <span className="mr-section-label">
                  {activeTab === "weekly-summary" ? `${market.label} · ${week}` : sectionTitle}
                </span>
                <ExportButton canExport={canImportExport} />
              </div>

              <DataGrid columns={TAB_COLUMNS[activeTab]} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
