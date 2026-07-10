export type Role = "viewer" | "admin";

export type User = {
  id: number;
  email: string;
  name: string | null;
  role: Role | string;
  createdAt?: string;
};

export type Capabilities = {
  canEdit: boolean;
  canImportExport: boolean;
  isViewer: boolean;
  isAdmin: boolean;
};

const API_BASE = import.meta.env.VITE_API_URL ?? "";

export type ApiError = {
  error: string;
};

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type") && options.body) {
    headers.set("Content-Type", "application/json");
  }

  const token = localStorage.getItem("token");
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  const data = (await response.json().catch(() => ({}))) as T | ApiError;

  if (!response.ok) {
    const message =
      typeof data === "object" && data && "error" in data
        ? String((data as ApiError).error)
        : "Request failed";
    throw new Error(message);
  }

  return data as T;
}

export const api = {
  health: () => request<{ status: string; service: string; timestamp: string }>("/api/health"),
  login: (body: { email: string; password: string }) =>
    request<{
      token: string;
      user: User;
    }>("/api/auth/login", { method: "POST", body: JSON.stringify(body) }),
  me: () =>
    request<{
      user: User;
      capabilities: Capabilities;
    }>("/api/auth/me"),
};
