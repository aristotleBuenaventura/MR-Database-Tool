import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, type Capabilities, type User } from "../api/client";

type AuthContextValue = {
  user: User | null;
  capabilities: Capabilities | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function homePathForRole(role: string): string {
  return role === "superadmin" ? "/admin" : "/dashboard";
}

const defaultCapabilities = (role: string): Capabilities => ({
  canEdit: role === "admin",
  canImportExport: role === "admin",
  isViewer: role === "viewer",
  isAdmin: role === "admin",
  isSuperadmin: role === "superadmin",
  canManageUsers: role === "superadmin",
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const token = localStorage.getItem("token");
    if (!token) {
      setUser(null);
      setCapabilities(null);
      setLoading(false);
      return;
    }

    try {
      const data = await api.me();
      setUser(data.user);
      setCapabilities(data.capabilities);
    } catch {
      localStorage.removeItem("token");
      setUser(null);
      setCapabilities(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const data = await api.login({ email, password });
    localStorage.setItem("token", data.token);
    setUser(data.user);
    setCapabilities(defaultCapabilities(data.user.role));
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      if (localStorage.getItem("token")) {
        await api.logout();
      }
    } catch {
      // Still clear local session even if the API call fails.
    } finally {
      localStorage.removeItem("token");
      setUser(null);
      setCapabilities(null);
    }
  }, []);

  const value = useMemo(
    () => ({ user, capabilities, loading, login, logout, refresh }),
    [user, capabilities, loading, login, logout, refresh],
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
