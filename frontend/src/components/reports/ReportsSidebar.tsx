import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { SuperadminReportsView } from "../../auth/superadminViewMode";
import {
  MONTHLY_MARKETS,
  PROMO_PARENT_MARKET_IDS,
  WEEKLY_MARKETS,
  findWeeklyMarket,
  promoWeeklyMarketId,
  regularWeeklyMarketId,
  type Market,
} from "../../config/reports";
import { BrandMark } from "../BrandMark";

type Props = {
  activeMarketId: string;
  /** True when opened via the SUMMARY sidebar shortcut (Weekly Summary only). */
  summaryLocked?: boolean;
  onSelectMarket: (market: Market) => void;
  onSelectSummary: (market: Market) => void;
  collapsed: boolean;
  onToggle: () => void;
  userLabel: string;
  role: string;
  reportsView?: SuperadminReportsView;
  onReportsViewChange?: (view: SuperadminReportsView) => void;
  onLogout: () => void;
};

function initials(label: string) {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
  }
  return label.slice(0, 2).toUpperCase() || "?";
}

function roleLabel(role: string, reportsView?: SuperadminReportsView) {
  if (role === "superadmin") {
    return reportsView === "viewer" ? "Viewer preview" : "Superadmin";
  }
  if (role === "admin") return "Admin";
  return "Viewer";
}

/** Original hamburger menu toggle */
function MenuIcon() {
  return (
    <span className="mr-hamburger" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

function ChevronIcon() {
  return (
    <svg
      className="mr-market-chevron-icon"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 4.5 10 8 6 11.5" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg
      className="mr-sidebar-svg"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M15 4.5h2.5A2.5 2.5 0 0 1 20 7v10a2.5 2.5 0 0 1-2.5 2.5H15" />
      <path d="M10 16.5 14.5 12 10 7.5" />
      <path d="M14.5 12H4" />
    </svg>
  );
}

export function ReportsSidebar({
  activeMarketId,
  summaryLocked = false,
  onSelectMarket,
  onSelectSummary,
  collapsed,
  onToggle,
  userLabel,
  role,
  reportsView,
  onReportsViewChange,
  onLogout,
}: Props) {
  const navigate = useNavigate();
  const isSuperadmin = role === "superadmin";
  const viewerPreview = isSuperadmin && reportsView === "viewer";
  const badgeRole = viewerPreview ? "viewer" : role;
  const activeParentId = regularWeeklyMarketId(activeMarketId);
  const weeklySelectionActive = !summaryLocked;
  const summarySelectionActive = summaryLocked;
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() =>
    PROMO_PARENT_MARKET_IDS.has(activeParentId)
      ? { [activeParentId]: true }
      : {},
  );

  useEffect(() => {
    if (!PROMO_PARENT_MARKET_IDS.has(activeParentId)) return;
    setOpenGroups((current) =>
      current[activeParentId] ? current : { ...current, [activeParentId]: true },
    );
  }, [activeParentId]);

  const expandedGroups = openGroups;

  function selectRegular(market: Market) {
    setOpenGroups((current) => ({ ...current, [market.id]: true }));
    onSelectMarket(market);
  }

  function selectPromo(parent: Market) {
    const promo = findWeeklyMarket(promoWeeklyMarketId(parent.id));
    if (!promo) return;
    setOpenGroups((current) => ({ ...current, [parent.id]: true }));
    onSelectMarket(promo);
  }

  function toggleGroup(marketId: string) {
    setOpenGroups((current) => ({
      ...current,
      [marketId]: !current[marketId],
    }));
  }

  /** Clicking M1/M2 again hides Regular/Promo. From another market, open and go Regular. */
  function onParentClick(market: Market) {
    if (regularWeeklyMarketId(activeMarketId) === market.id) {
      toggleGroup(market.id);
      return;
    }
    selectRegular(market);
  }

  return (
    <aside className={`mr-sidebar ${collapsed ? "collapsed" : ""}`}>
      <div className="mr-sidebar-header">
        {!collapsed ? (
          <div className="mr-sidebar-brand">
            <BrandMark className="mr-sidebar-brand-mark" size={34} />
            <div className="mr-sidebar-brand-copy">
              <span className="mr-sidebar-brand-kicker">MR Database Tool</span>
              <span className="mr-sidebar-title">Master Reports</span>
            </div>
          </div>
        ) : null}
        <button
          type="button"
          className="mr-icon-btn"
          onClick={onToggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand" : "Collapse"}
        >
          <MenuIcon />
        </button>
      </div>

      {!collapsed ? (
        <>
          <div className="mr-sidebar-body">
            <div className="mr-sidebar-section">
              <p className="mr-sidebar-section-title">Weekly</p>
              <ul>
                {WEEKLY_MARKETS.map((market) => {
                  const hasPromo = PROMO_PARENT_MARKET_IDS.has(market.id);
                  if (!hasPromo) {
                    return (
                      <li key={market.id}>
                        <button
                          type="button"
                          className={
                            weeklySelectionActive && activeMarketId === market.id
                              ? "mr-market-option is-selected"
                              : "mr-market-option"
                          }
                          onClick={() => onSelectMarket(market)}
                        >
                          <span className="mr-market-dot" aria-hidden />
                          <span>{market.label}</span>
                        </button>
                      </li>
                    );
                  }

                  const expanded = Boolean(expandedGroups[market.id]);
                  const promoId = promoWeeklyMarketId(market.id);
                  const parentActive =
                    weeklySelectionActive &&
                    (activeMarketId === market.id || activeMarketId === promoId);

                  return (
                    <li
                      key={market.id}
                      className={
                        parentActive
                          ? "mr-market-group is-current"
                          : "mr-market-group"
                      }
                    >
                      <button
                        type="button"
                        className={[
                          "mr-market-option mr-market-parent",
                          parentActive ? "is-current" : "",
                          expanded ? "is-open" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        aria-expanded={expanded}
                        onClick={() => onParentClick(market)}
                      >
                        <span className="mr-market-dot" aria-hidden />
                        <span>{market.label}</span>
                        <span className="mr-market-chevron" aria-hidden>
                          <ChevronIcon />
                        </span>
                      </button>
                      {expanded ? (
                        <ul className="mr-market-sub">
                          <li>
                            <button
                              type="button"
                              className={
                                weeklySelectionActive &&
                                activeMarketId === market.id
                                  ? "mr-market-option is-child is-selected"
                                  : "mr-market-option is-child"
                              }
                              onClick={() => selectRegular(market)}
                            >
                              Regular Weekly
                            </button>
                          </li>
                          <li>
                            <button
                              type="button"
                              className={
                                weeklySelectionActive &&
                                activeMarketId === promoId
                                  ? "mr-market-option is-child is-selected"
                                  : "mr-market-option is-child"
                              }
                              onClick={() => selectPromo(market)}
                            >
                              Promo Weekly
                            </button>
                          </li>
                        </ul>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="mr-sidebar-section">
              <p className="mr-sidebar-section-title">Monthly</p>
              <ul>
                {MONTHLY_MARKETS.map((market) => (
                  <li key={market.id}>
                    <button
                      type="button"
                      className={
                        weeklySelectionActive && activeMarketId === market.id
                          ? "mr-market-option is-selected"
                          : "mr-market-option"
                      }
                      onClick={() => onSelectMarket(market)}
                    >
                      <span className="mr-market-dot" aria-hidden />
                      <span>{market.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            <div className="mr-sidebar-section">
              <p className="mr-sidebar-section-title">Summary</p>
              <ul>
                {WEEKLY_MARKETS.map((market) => (
                  <li key={`summary-${market.id}`}>
                    <button
                      type="button"
                      className={
                        summarySelectionActive && activeMarketId === market.id
                          ? "mr-market-option is-selected"
                          : "mr-market-option"
                      }
                      onClick={() => onSelectSummary(market)}
                    >
                      <span className="mr-market-dot" aria-hidden />
                      <span>{market.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="mr-sidebar-footer">
            <div className="mr-user-chip">
              <span className="mr-user-avatar" aria-hidden>
                {initials(userLabel)}
              </span>
              <div className="mr-user-meta">
                <strong>{userLabel}</strong>
                <span className={`role-badge role-${badgeRole}`}>
                  {roleLabel(role, reportsView)}
                </span>
              </div>
            </div>
            {isSuperadmin && onReportsViewChange ? (
              <div className="mr-view-switch" role="group" aria-label="Reports view">
                <button
                  type="button"
                  className={
                    reportsView === "admin"
                      ? "mr-view-switch-btn is-active"
                      : "mr-view-switch-btn"
                  }
                  onClick={() => onReportsViewChange("admin")}
                >
                  Admin
                </button>
                <button
                  type="button"
                  className={
                    reportsView === "viewer"
                      ? "mr-view-switch-btn is-active"
                      : "mr-view-switch-btn"
                  }
                  onClick={() => onReportsViewChange("viewer")}
                >
                  Viewer
                </button>
              </div>
            ) : null}
            {isSuperadmin ? (
              <button
                type="button"
                className="mr-switch-admin"
                onClick={() => navigate("/admin")}
              >
                Admin Dashboard
              </button>
            ) : null}
            <button type="button" className="mr-logout" onClick={onLogout}>
              Logout
            </button>
          </div>
        </>
      ) : (
        <div className="mr-sidebar-collapsed-rail">
          {isSuperadmin && onReportsViewChange ? (
            <button
              type="button"
              className="mr-sidebar-rail-btn"
              onClick={() =>
                onReportsViewChange(reportsView === "viewer" ? "admin" : "viewer")
              }
              aria-label={
                reportsView === "viewer" ? "Switch to Admin view" : "Switch to Viewer view"
              }
              title={
                reportsView === "viewer" ? "Switch to Admin view" : "Switch to Viewer view"
              }
            >
              {reportsView === "viewer" ? "VW" : "AD"}
            </button>
          ) : null}
          {isSuperadmin ? (
            <button
              type="button"
              className="mr-sidebar-rail-btn"
              onClick={() => navigate("/admin")}
              aria-label="Admin Dashboard"
              title="Admin Dashboard"
            >
              SA
            </button>
          ) : null}
          <button
            type="button"
            className="mr-sidebar-rail-btn"
            onClick={onLogout}
            aria-label="Logout"
            title="Logout"
          >
            <LogoutIcon />
          </button>
        </div>
      )}
    </aside>
  );
}
