import { MONTHLY_MARKETS, WEEKLY_MARKETS, type Market } from "../../config/reports";

type Props = {
  activeMarketId: string;
  onSelectMarket: (market: Market) => void;
  collapsed: boolean;
  onToggle: () => void;
  userLabel: string;
  role: string;
  onLogout: () => void;
};

export function ReportsSidebar({
  activeMarketId,
  onSelectMarket,
  collapsed,
  onToggle,
  userLabel,
  role,
  onLogout,
}: Props) {
  return (
    <aside className={`mr-sidebar ${collapsed ? "collapsed" : ""}`}>
      <div className="mr-sidebar-header">
        {!collapsed ? <span className="mr-sidebar-title">MASTER REPORTS DASHBOARD</span> : null}
        <button type="button" className="mr-icon-btn" onClick={onToggle} aria-label="Toggle sidebar">
          <span />
          <span />
          <span />
        </button>
      </div>

      {!collapsed ? (
        <>
          <div className="mr-sidebar-body">
            <div className="mr-sidebar-section">
              <p className="mr-sidebar-section-title">WEEKLY</p>
              <ul>
                {WEEKLY_MARKETS.map((market) => (
                  <li key={market.id}>
                    <button
                      type="button"
                      className={activeMarketId === market.id ? "active" : ""}
                      onClick={() => onSelectMarket(market)}
                    >
                      {market.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            <div className="mr-sidebar-section">
              <p className="mr-sidebar-section-title">MONTHLY</p>
              <ul>
                {MONTHLY_MARKETS.map((market) => (
                  <li key={market.id}>
                    <button
                      type="button"
                      className={activeMarketId === market.id ? "active" : ""}
                      onClick={() => onSelectMarket(market)}
                    >
                      {market.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="mr-sidebar-footer">
            <div className="mr-user-chip">
              <span>{userLabel}</span>
              <span className={`role-badge role-${role}`}>{role}</span>
            </div>
            <button type="button" className="mr-logout" onClick={onLogout}>
              Logout
            </button>
          </div>
        </>
      ) : null}
    </aside>
  );
}
