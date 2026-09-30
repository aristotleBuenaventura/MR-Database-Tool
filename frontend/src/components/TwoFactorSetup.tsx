import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import QRCode from "qrcode";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";

type Props = {
  /** Force fullscreen gate when 2FA must be set up. */
  blocking?: boolean;
};

export function TwoFactorSetup({ blocking = false }: Props) {
  const navigate = useNavigate();
  const { user, capabilities, setCapabilities, refresh, logout } = useAuth();
  const [secret, setSecret] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (capabilities?.totpEnabled && !blocking) {
    return (
      <section className={`panel ${blocking ? "narrow" : ""} security-2fa-card`}>
        <h2>Two-factor authentication</h2>
        <p className="lede">2FA is enabled for this account.</p>
      </section>
    );
  }

  async function startSetup() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const data = await api.setup2fa(password);
      setSecret(data.secret);
      const qr = await QRCode.toDataURL(data.otpauthUrl, {
        width: 220,
        margin: 2,
        errorCorrectionLevel: "M",
        color: { dark: "#111111", light: "#ffffff" },
      });
      setQrDataUrl(qr);
      setNotice(
        "Scan the QR code with your authenticator app, then enter a code to confirm.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start 2FA setup");
    } finally {
      setBusy(false);
    }
  }

  async function onEnable(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await api.enable2fa(code.trim());
      setCapabilities(data.capabilities);
      setNotice("2FA enabled successfully.");
      setSecret(null);
      setQrDataUrl(null);
      setCode("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to enable 2FA");
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    setBusy(true);
    try {
      await logout();
      navigate("/login", { replace: true });
    } finally {
      setBusy(false);
    }
  }

  const body = (
    <section
      className={`panel ${blocking ? "narrow" : ""} security-2fa-card${
        blocking ? " is-blocking" : ""
      }`}
    >
      <header className="security-2fa-head">
        <h2>{blocking ? "Set up 2FA to continue" : "Two-factor authentication"}</h2>
        <p className="lede">
          Admin and Superadmin accounts require an authenticator app (Google
          Authenticator, Authy, 1Password, etc.).
        </p>
      </header>

      {blocking && user ? (
        <div className="security-2fa-account">
          <span className="security-2fa-account-label">Signed in as</span>
          <strong className="security-2fa-account-email">{user.email}</strong>
        </div>
      ) : null}

      <div className="security-2fa-body">
        {!secret ? (
          <form
            className="form security-2fa-form"
            onSubmit={(event) => {
              event.preventDefault();
              void startSetup();
            }}
          >
            <label>
              Password
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                autoComplete="current-password"
                placeholder="Confirm your password"
              />
            </label>
            <button
              type="submit"
              className="admin-btn primary security-2fa-primary"
              disabled={busy || !password}
            >
              {busy ? "Preparing..." : "Start 2FA setup"}
            </button>
          </form>
        ) : (
          <form className="form security-2fa-form" onSubmit={onEnable}>
            {qrDataUrl ? (
              <div className="security-qr-wrap">
                <img
                  src={qrDataUrl}
                  alt="Scan this QR code with your authenticator app"
                  className="security-qr-image"
                  width={220}
                  height={220}
                />
                <p className="mr-field-hint">
                  Scan this QR code with your authenticator app
                </p>
              </div>
            ) : null}
            <p className="security-secret-box">
              <strong>Or enter this key manually</strong>
              <code>{secret}</code>
            </p>
            <label>
              Verification code
              <input
                type="text"
                inputMode="numeric"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
                minLength={6}
                maxLength={8}
                autoComplete="one-time-code"
                placeholder="123456"
              />
            </label>
            <button
              type="submit"
              className="admin-btn primary security-2fa-primary"
              disabled={busy}
            >
              {busy ? "Enabling..." : "Enable 2FA"}
            </button>
          </form>
        )}
      </div>

      {error ? <p className="error">{error}</p> : null}
      {notice ? <p className="admin-banner notice">{notice}</p> : null}

      {blocking ? (
        <footer className="security-2fa-footer">
          <button
            type="button"
            className="security-2fa-logout"
            disabled={busy}
            onClick={() => void handleLogout()}
          >
            Sign out / switch account
          </button>
        </footer>
      ) : null}
    </section>
  );

  if (!blocking) return body;

  return <div className="security-2fa-gate">{body}</div>;
}
