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
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const defaultCapabilities = (role: string): Capabilities => ({
  canEdit: role === "admin",
  canImportExport: role === "admin",
  isViewer: role === "viewer",
  isAdmin: role === "admin",
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
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("token");
    setUser(null);
    setCapabilities(null);
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
