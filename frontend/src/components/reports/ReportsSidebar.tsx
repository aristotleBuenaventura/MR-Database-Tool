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

function initials(label: string) {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
  }
  return label.slice(0, 2).toUpperCase() || "?";
}

function roleLabel(role: string) {
  if (role === "superadmin") return "Superadmin";
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
        {!collapsed ? (
          <div className="mr-sidebar-brand">
            <span className="mr-sidebar-brand-mark" aria-hidden>
              MR
            </span>
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
                {WEEKLY_MARKETS.map((market) => (
                  <li key={market.id}>
                    <button
                      type="button"
                      className={
                        activeMarketId === market.id
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
              <p className="mr-sidebar-section-title">Monthly</p>
              <ul>
                {MONTHLY_MARKETS.map((market) => (
                  <li key={market.id}>
                    <button
                      type="button"
                      className={
                        activeMarketId === market.id
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
          </div>

          <div className="mr-sidebar-footer">
            <div className="mr-user-chip">
              <span className="mr-user-avatar" aria-hidden>
                {initials(userLabel)}
              </span>
              <div className="mr-user-meta">
                <strong>{userLabel}</strong>
                <span className={`role-badge role-${role}`}>{roleLabel(role)}</span>
              </div>
            </div>
            <button type="button" className="mr-logout" onClick={onLogout}>
              Logout
            </button>
          </div>
        </>
      ) : (
        <div className="mr-sidebar-collapsed-rail">
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
