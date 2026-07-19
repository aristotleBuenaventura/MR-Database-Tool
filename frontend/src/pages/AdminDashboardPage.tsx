import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api, type ManagedUser } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { BrandMark } from "../components/BrandMark";
import { TwoFactorSetup } from "../components/TwoFactorSetup";

type CreateForm = {
  email: string;
  name: string;
  password: string;
  role: "viewer" | "admin";
};

const emptyCreate: CreateForm = {
  email: "",
  name: "",
  password: "",
  role: "viewer",
};

function formatWhen(value: string) {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function roleLabel(role: string) {
  if (role === "superadmin") return "Superadmin";
  if (role === "admin") return "Admin";
  return "Viewer";
}

function initials(name: string | null, email: string) {
  const source = (name || email).trim();
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase() || "?";
}

export function AdminDashboardPage() {
  const navigate = useNavigate();
  const { user, capabilities, logout } = useAuth();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState<CreateForm>(emptyCreate);
  const [creating, setCreating] = useState(false);
  const [passwordUserId, setPasswordUserId] = useState<number | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [busyId, setBusyId] = useState<number | string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ManagedUser | null>(null);

  const loadUsers = useCallback(async (opts?: { quiet?: boolean }) => {
    if (!opts?.quiet) setRefreshing(true);
    try {
      const data = await api.listUsers();
      setUsers(data.users);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load accounts");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadUsers();
    const timer = window.setInterval(() => {
      void loadUsers({ quiet: true });
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [loadUsers]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    setCreating(true);
    setNotice(null);
    setError(null);
    try {
      await api.createUser({
        email: createForm.email.trim(),
        password: createForm.password,
        name: createForm.name.trim() || undefined,
        role: createForm.role,
      });
      setCreateForm(emptyCreate);
      setNotice(`Created ${createForm.role} account.`);
      await loadUsers({ quiet: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create account");
    } finally {
      setCreating(false);
    }
  }

  async function onChangePassword(userId: number) {
    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    setBusyId(userId);
    setError(null);
    setNotice(null);
    try {
      await api.changeUserPassword(userId, newPassword);
      setPasswordUserId(null);
      setNewPassword("");
      setNotice("Password updated. Other sessions were logged out.");
      await loadUsers({ quiet: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change password");
    } finally {
      setBusyId(null);
    }
  }

  async function onForceLogoutUser(target: ManagedUser) {
    if (target.id === user?.id) return;
    setBusyId(target.id);
    setError(null);
    setNotice(null);
    try {
      const result = await api.forceLogoutUser(target.id);
      setNotice(
        result.revoked
          ? `Logged out ${result.revoked} session(s) for ${target.email}.`
          : `${target.email} had no active sessions.`,
      );
      await loadUsers({ quiet: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to logout sessions");
    } finally {
      setBusyId(null);
    }
  }

  async function onForceLogoutSession(sessionId: string) {
    setBusyId(sessionId);
    setError(null);
    setNotice(null);
    try {
      await api.forceLogoutSession(sessionId);
      setNotice("Session logged out.");
      await loadUsers({ quiet: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to logout session");
    } finally {
      setBusyId(null);
    }
  }

  async function onConfirmDelete() {
    if (!deleteTarget) return;
    setBusyId(deleteTarget.id);
    setError(null);
    setNotice(null);
    try {
      await api.deleteUser(deleteTarget.id);
      setNotice(`Deleted ${deleteTarget.email}.`);
      setDeleteTarget(null);
      await loadUsers({ quiet: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete account");
    } finally {
      setBusyId(null);
    }
  }

  const onlineCount = users.filter((u) => u.online).length;
  const adminCount = users.filter((u) => u.role === "admin").length;
  const viewerCount = users.filter((u) => u.role === "viewer").length;

  if (capabilities?.mustSetup2fa) {
    return (
      <div className="login-shell">
        <header className="login-topbar">
          <div className="login-topbar-inner">
            <div className="brand-lockup">
              <BrandMark />
              <div className="brand-copy">
                <span className="brand-kicker">MR Database Tool</span>
                <span className="brand">Security setup</span>
              </div>
            </div>
          </div>
        </header>
        <main className="login-content">
          <TwoFactorSetup blocking />
        </main>
        <span className="mr-credit">Developed by Aris</span>
      </div>
    );
  }

  return (
    <div className="admin-shell">
      <header className="admin-hero">
        <div className="admin-hero-inner">
          <div className="admin-hero-copy">
            <div className="admin-hero-brand-row">
              <BrandMark />
              <p className="admin-brand">MR Database Tool</p>
            </div>
            <h1>Admin Dashboard</h1>
            <p className="admin-hero-lede">
              Manage accounts, passwords, and live sessions.
            </p>
          </div>
          <div className="admin-hero-actions">
            <div className="admin-user-card">
              <span className="admin-avatar self">
                {initials(user?.name ?? null, user?.email ?? "SA")}
              </span>
              <div>
                <strong>{user?.name ?? "Super Admin"}</strong>
                <span>{user?.email}</span>
              </div>
              <span className="role-badge role-superadmin">Superadmin</span>
            </div>
            <button
              type="button"
              className="admin-btn ghost light"
              onClick={() => void handleLogout()}
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="admin-main">
        <section className="admin-stats">
          <div className="admin-stat">
            <span className="admin-stat-label">Accounts</span>
            <strong>{users.length}</strong>
          </div>
          <div className="admin-stat accent">
            <span className="admin-stat-label">Online now</span>
            <strong>
              <span className="admin-dot live" />
              {onlineCount}
            </strong>
          </div>
          <div className="admin-stat">
            <span className="admin-stat-label">Admins</span>
            <strong>{adminCount}</strong>
          </div>
          <div className="admin-stat">
            <span className="admin-stat-label">Viewers</span>
            <strong>{viewerCount}</strong>
          </div>
        </section>

        {error ? <p className="admin-banner error">{error}</p> : null}
        {notice ? <p className="admin-banner notice">{notice}</p> : null}

        <section className="admin-grid">
          <aside className="admin-panel admin-create">
            <div className="admin-panel-head">
              <h2>Add account</h2>
              <p>Create a viewer or admin. Superadmin cannot be created here.</p>
            </div>
            <form className="admin-form" onSubmit={onCreate}>
              <label>
                Name
                <input
                  value={createForm.name}
                  onChange={(e) =>
                    setCreateForm((prev) => ({ ...prev, name: e.target.value }))
                  }
                  placeholder="Optional display name"
                  autoComplete="off"
                />
              </label>
              <label>
                Email
                <input
                  type="email"
                  value={createForm.email}
                  onChange={(e) =>
                    setCreateForm((prev) => ({ ...prev, email: e.target.value }))
                  }
                  required
                  placeholder="name@company.com"
                  autoComplete="off"
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  value={createForm.password}
                  onChange={(e) =>
                    setCreateForm((prev) => ({
                      ...prev,
                      password: e.target.value,
                    }))
                  }
                  required
                  minLength={8}
                  placeholder="At least 8 characters"
                  autoComplete="new-password"
                />
              </label>
              <fieldset className="admin-role-picker">
                <legend>Role</legend>
                <div className="admin-role-options">
                  <button
                    type="button"
                    className={
                      createForm.role === "viewer" ? "is-active" : undefined
                    }
                    onClick={() =>
                      setCreateForm((prev) => ({ ...prev, role: "viewer" }))
                    }
                  >
                    Viewer
                    <small>Read-only access</small>
                  </button>
                  <button
                    type="button"
                    className={
                      createForm.role === "admin" ? "is-active" : undefined
                    }
                    onClick={() =>
                      setCreateForm((prev) => ({ ...prev, role: "admin" }))
                    }
                  >
                    Admin
                    <small>Full report access</small>
                  </button>
                </div>
              </fieldset>
              <button
                type="submit"
                className="admin-btn primary wide"
                disabled={creating}
              >
                {creating ? "Creating..." : "Create account"}
              </button>
            </form>
          </aside>

          <section className="admin-panel admin-accounts">
            <div className="admin-panel-head row">
              <div>
                <h2>Accounts</h2>
                <p>Status refreshes every 15 seconds.</p>
              </div>
              <button
                type="button"
                className="admin-btn ghost"
                disabled={refreshing}
                onClick={() => void loadUsers()}
              >
                {refreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>

            {loading && users.length === 0 ? (
              <div className="admin-empty">Loading accounts...</div>
            ) : (
              <div className="admin-account-list">
                {users.map((account) => {
                  const isSelf = account.id === user?.id;
                  const roleClass =
                    account.role === "superadmin"
                      ? "superadmin"
                      : account.role === "admin"
                        ? "admin"
                        : "viewer";

                  return (
                    <article
                      key={account.id}
                      className={`admin-account-card ${
                        account.online ? "is-online" : ""
                      }`}
                    >
                      <div className="admin-account-top">
                        <div className="admin-account-identity">
                          <span className={`admin-avatar tone-${roleClass}`}>
                            {initials(account.name, account.email)}
                            <span
                              className={`admin-status-pip ${
                                account.online ? "on" : "off"
                              }`}
                              title={account.online ? "Online" : "Offline"}
                            />
                          </span>
                          <div>
                            <div className="admin-account-name">
                              <strong>{account.name || "Unnamed"}</strong>
                              {isSelf ? (
                                <span className="admin-you">You</span>
                              ) : null}
                            </div>
                            <span className="admin-account-email">
                              {account.email}
                            </span>
                          </div>
                        </div>
                        <div className="admin-account-meta">
                          <span className={`role-badge role-${roleClass}`}>
                            {roleLabel(account.role)}
                          </span>
                          <span
                            className={`admin-presence ${
                              account.online ? "is-online" : "is-offline"
                            }`}
                          >
                            <span className="admin-dot" />
                            {account.online ? "Online" : "Offline"}
                          </span>
                        </div>
                      </div>

                      <div className="admin-account-body">
                        <div className="admin-sessions-block">
                          <h3>
                            Sessions
                            <span>{account.activeSessions.length}</span>
                          </h3>
                          {account.activeSessions.length === 0 ? (
                            <p className="admin-muted">No active sessions</p>
                          ) : (
                            <ul className="admin-session-list">
                              {account.activeSessions.map((session) => (
                                <li key={session.id}>
                                  <div>
                                    <span
                                      className={`admin-presence compact ${
                                        session.online
                                          ? "is-online"
                                          : "is-offline"
                                      }`}
                                    >
                                      <span className="admin-dot" />
                                      {session.online ? "Active" : "Idle"}
                                    </span>
                                    <small>
                                      Last seen {formatWhen(session.lastSeenAt)}
                                    </small>
                                  </div>
                                  {!isSelf ? (
                                    <button
                                      type="button"
                                      className="admin-btn danger small"
                                      disabled={busyId === session.id}
                                      onClick={() =>
                                        void onForceLogoutSession(session.id)
                                      }
                                    >
                                      Logout
                                    </button>
                                  ) : null}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>

                        <div className="admin-actions-block">
                          <div className="admin-actions">
                            <button
                              type="button"
                              className="admin-btn ghost small"
                              onClick={() => {
                                setPasswordUserId(
                                  passwordUserId === account.id
                                    ? null
                                    : account.id,
                                );
                                setNewPassword("");
                              }}
                            >
                              Change password
                            </button>
                            {!isSelf ? (
                              <button
                                type="button"
                                className="admin-btn danger small"
                                disabled={
                                  busyId === account.id ||
                                  account.activeSessions.length === 0
                                }
                                onClick={() => void onForceLogoutUser(account)}
                              >
                                Logout all
                              </button>
                            ) : null}
                            {!isSelf && account.role !== "superadmin" ? (
                              <button
                                type="button"
                                className="admin-btn danger small"
                                disabled={busyId === account.id}
                                onClick={() => setDeleteTarget(account)}
                              >
                                Delete
                              </button>
                            ) : null}
                          </div>

                          {passwordUserId === account.id ? (
                            <div className="admin-password-row">
                              <input
                                type="password"
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                placeholder="New password (min 8)"
                                minLength={8}
                                autoComplete="new-password"
                              />
                              <button
                                type="button"
                                className="admin-btn primary small"
                                disabled={busyId === account.id}
                                onClick={() =>
                                  void onChangePassword(account.id)
                                }
                              >
                                Save
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </section>
      </main>

      <span className="mr-credit">Developed by Aris</span>

      {deleteTarget ? (
        <div
          className="mr-modal-backdrop"
          role="presentation"
          onClick={() => setDeleteTarget(null)}
        >
          <div
            className="mr-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-user-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="mr-modal-header">
              <div>
                <h2 id="delete-user-title">Delete account</h2>
              </div>
              <button
                type="button"
                className="mr-modal-close"
                onClick={() => setDeleteTarget(null)}
                aria-label="Close"
              >
                ×
              </button>
            </header>
            <div className="mr-modal-body">
              <p className="mr-modal-hint">
                Are you sure you want to delete this account? This cannot be
                undone. All active sessions will be logged out.
              </p>
              <div className="mr-reject-review">
                <p className="mr-reject-review-count">Account to delete</p>
                <ul className="mr-reject-username-list">
                  <li>
                    <strong>{deleteTarget.name || "Unnamed"}</strong>
                    {" — "}
                    {deleteTarget.email}
                    {" ("}
                    {roleLabel(deleteTarget.role)}
                    {")"}
                  </li>
                </ul>
              </div>
            </div>
            <footer className="mr-modal-footer">
              <button
                type="button"
                className="mr-btn-secondary"
                onClick={() => setDeleteTarget(null)}
                disabled={busyId === deleteTarget.id}
              >
                No
              </button>
              <button
                type="button"
                className="mr-btn-primary"
                disabled={busyId === deleteTarget.id}
                onClick={() => void onConfirmDelete()}
              >
                {busyId === deleteTarget.id ? "Deleting..." : "Yes, delete"}
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  );
}
