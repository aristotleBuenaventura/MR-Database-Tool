import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { homePathForRole, useAuth } from "../auth/AuthContext";
import { ThemeToggle } from "../components/ThemeToggle";

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, verify2fa } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice] = useState<string | null>(() => {
    const state = location.state as { notice?: string } | null;
    return state?.notice ?? null;
  });
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (challengeToken) {
        const user = await verify2fa(challengeToken, code.trim());
        navigate(homePathForRole(user.role), { replace: true });
        return;
      }

      const result = await login(email, password);
      if (result.requires2fa) {
        setChallengeToken(result.challengeToken);
        setPassword("");
        return;
      }
      navigate(homePathForRole(result.user.role), { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="panel narrow">
      <h1>Login</h1>
      <p className="lede">
        {challengeToken
          ? "Enter the 6-digit code from your authenticator app."
          : "Sign in to access Master Reports Dashboard."}
      </p>
      <form className="form" onSubmit={onSubmit}>
        {!challengeToken ? <ThemeToggle /> : null}
        {challengeToken ? (
          <label>
            Authenticator code
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              minLength={6}
              maxLength={8}
              placeholder="123456"
              autoFocus
            />
          </label>
        ) : (
          <>
            <label>
              Email
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </label>
            <label>
              Password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </label>
          </>
        )}
        {error ? <p className="error">{error}</p> : null}
        {notice && !challengeToken ? (
          <p className="admin-banner notice">{notice}</p>
        ) : null}
        <button type="submit" disabled={loading}>
          {loading
            ? challengeToken
              ? "Verifying..."
              : "Signing in..."
            : challengeToken
              ? "Verify code"
              : "Sign in"}
        </button>
        {challengeToken ? (
          <button
            type="button"
            className="admin-btn ghost"
            onClick={() => {
              setChallengeToken(null);
              setCode("");
              setError(null);
            }}
          >
            Back to login
          </button>
        ) : (
          <p className="auth-alt-link">
            <Link to="/forgot-password">Forgot password?</Link>
          </p>
        )}
      </form>
    </section>
  );
}
