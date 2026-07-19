import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ApiRequestError, api } from "../api/client";
import { ThemeToggle } from "../components/ThemeToggle";

const COOLDOWN_STORAGE_KEY = "mr-pw-reset-cooldown";

function formatWait(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m <= 0) return `${s}s`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function readCooldownMap(): Record<string, number> {
  try {
    const raw = localStorage.getItem(COOLDOWN_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, number>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function remainingForEmail(email: string): number {
  const endsAt = readCooldownMap()[email.trim().toLowerCase()] ?? 0;
  return Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
}

function persistCooldown(email: string, seconds: number) {
  const key = email.trim().toLowerCase();
  if (!key || seconds <= 0) return;

  const map = readCooldownMap();
  const now = Date.now();
  for (const [e, endsAt] of Object.entries(map)) {
    if (endsAt <= now) delete map[e];
  }
  map[key] = now + seconds * 1000;
  localStorage.setItem(COOLDOWN_STORAGE_KEY, JSON.stringify(map));
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [cooldownLeft, setCooldownLeft] = useState(0);

  useEffect(() => {
    setCooldownLeft(remainingForEmail(email));
  }, [email]);

  useEffect(() => {
    if (cooldownLeft <= 0) return;
    const id = window.setTimeout(() => {
      setCooldownLeft(remainingForEmail(email));
    }, 1000);
    return () => window.clearTimeout(id);
  }, [cooldownLeft, email]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const normalized = email.trim();
    if (!normalized) return;

    const localRemaining = remainingForEmail(normalized);
    if (localRemaining > 0) {
      setCooldownLeft(localRemaining);
      setError(
        `Please wait ${formatWait(localRemaining)} before requesting another link.`,
      );
      setMessage(null);
      return;
    }

    setError(null);
    setMessage(null);
    setLoading(true);
    try {
      const result = await api.forgotPassword(normalized);
      const wait = Math.max(1, result.retryAfterSeconds ?? 120);
      persistCooldown(normalized, wait);
      setCooldownLeft(wait);
      setMessage(result.message);
    } catch (err) {
      if (err instanceof ApiRequestError && err.retryAfterSeconds) {
        persistCooldown(normalized, err.retryAfterSeconds);
        setCooldownLeft(err.retryAfterSeconds);
      }
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }

  const blocked = loading || cooldownLeft > 0;

  return (
    <section className="panel narrow">
      <h1>Forgot password</h1>
      <p className="lede">
        Enter your account email and we&apos;ll send a reset link if it exists.
      </p>
      <form className="form" onSubmit={onSubmit}>
        <ThemeToggle />
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            autoFocus
          />
        </label>
        {error ? <p className="error">{error}</p> : null}
        {message ? <p className="admin-banner notice">{message}</p> : null}
        {cooldownLeft > 0 ? (
          <p className="mr-field-hint">
            You can request another link in {formatWait(cooldownLeft)}.
          </p>
        ) : null}
        <button type="submit" disabled={blocked}>
          {loading
            ? "Sending..."
            : cooldownLeft > 0
              ? `Wait ${formatWait(cooldownLeft)}`
              : "Send reset link"}
        </button>
        <p className="auth-alt-link">
          <Link to="/login">Back to login</Link>
        </p>
      </form>
    </section>
  );
}
