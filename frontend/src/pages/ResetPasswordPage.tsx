import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { ThemeToggle } from "../components/ThemeToggle";

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token")?.trim() ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!token) {
      setError("Missing reset token. Request a new password reset link.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      await api.resetPassword(token, password);
      navigate("/login", {
        replace: true,
        state: { notice: "Password updated. Sign in with your new password." },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed");
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <section className="panel narrow">
        <h1>Reset password</h1>
        <p className="lede">This reset link is missing or incomplete.</p>
        <p className="auth-alt-link">
          <Link to="/forgot-password">Request a new reset link</Link>
        </p>
        <p className="auth-alt-link">
          <Link to="/login">Back to login</Link>
        </p>
      </section>
    );
  }

  return (
    <section className="panel narrow">
      <h1>Reset password</h1>
      <p className="lede">Choose a new password for your account.</p>
      <form className="form" onSubmit={onSubmit}>
        <ThemeToggle />
        <label>
          New password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
            autoFocus
          />
        </label>
        <label>
          Confirm password
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
          />
        </label>
        {error ? <p className="error">{error}</p> : null}
        <button type="submit" disabled={loading}>
          {loading ? "Updating..." : "Update password"}
        </button>
        <p className="auth-alt-link">
          <Link to="/login">Back to login</Link>
        </p>
      </form>
    </section>
  );
}
