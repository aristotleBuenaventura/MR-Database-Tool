import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, type Capabilities, type User, AUTH_NOTICE_KEY, setUnauthorizedHandler } from "../api/client";

type AuthContextValue = {
  user: User | null;
  capabilities: Capabilities | null;
  loading: boolean;
  login: (
    email: string,
    password: string,
  ) => Promise<{ requires2fa: true; challengeToken: string } | { requires2fa: false; user: User }>;
  verify2fa: (challengeToken: string, code: string) => Promise<User>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  setCapabilities: (capabilities: Capabilities) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function homePathForRole(role: string): string {
  return role === "superadmin" ? "/admin" : "/dashboard";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api.me();
      setUser(data.user);
      setCapabilities(data.capabilities);
    } catch {
      setUser(null);
      setCapabilities(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSessionExpired = useCallback(() => {
    setUser(null);
    setCapabilities(null);
    const path = window.location.pathname;
    const stayOnPage =
      path === "/login" ||
      path.startsWith("/forgot-password") ||
      path.startsWith("/reset-password");
    if (stayOnPage) return;
    try {
      sessionStorage.setItem(
        AUTH_NOTICE_KEY,
        "Your session expired. Please sign in again.",
      );
    } catch {
      // ignore
    }
    window.location.replace("/login");
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(handleSessionExpired);
    return () => setUnauthorizedHandler(null);
  }, [handleSessionExpired]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Clear legacy localStorage tokens from older builds.
  useEffect(() => {
    try {
      localStorage.removeItem("token");
    } catch {
      // ignore
    }
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const data = await api.login({ email, password });
    if ("requires2fa" in data && data.requires2fa) {
      return { requires2fa: true as const, challengeToken: data.challengeToken };
    }
    setUser(data.user);
    setCapabilities(data.capabilities);
    return { requires2fa: false as const, user: data.user };
  }, []);

  const verify2fa = useCallback(async (challengeToken: string, code: string) => {
    const data = await api.verify2fa({ challengeToken, code });
    setUser(data.user);
    setCapabilities(data.capabilities);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // Still clear local session even if the API call fails.
    } finally {
      setUser(null);
      setCapabilities(null);
    }
  }, []);

  const value = useMemo(
    () => ({
      user,
      capabilities,
      loading,
      login,
      verify2fa,
      logout,
      refresh,
      setCapabilities,
    }),
    [user, capabilities, loading, login, verify2fa, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
