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

export type ReportDataset = {
  id: number;
  marketId: string;
  week: string;
  tabId: string;
  category: string;
  columns: string[];
  rows: string[][];
  fileName: string | null;
  sheetName: string | null;
  location: string | null;
  uploadedBy: number | null;
  updatedAt: string;
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
  getReport: (params: {
    marketId: string;
    week: string;
    tabId: string;
    category?: string;
  }) => {
    const query = new URLSearchParams({
      marketId: params.marketId,
      week: params.week,
      tabId: params.tabId,
      category: params.category ?? "",
    });
    return request<{ dataset: ReportDataset | null }>(`/api/reports?${query}`);
  },
  getDatabaseReports: (params: { marketId: string; week: string }) => {
    const query = new URLSearchParams({
      marketId: params.marketId,
      week: params.week,
    });
    return request<{ datasets: ReportDataset[] }>(`/api/reports/database?${query}`);
  },
  saveReport: (body: {
    marketId: string;
    week: string;
    tabId: string;
    category?: string;
    columns: string[];
    rows: string[][];
    fileName?: string | null;
    sheetName?: string | null;
    location?: string | null;
  }) =>
    request<{ dataset: ReportDataset }>("/api/reports", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  saveReportsBulk: (body: {
    marketId: string;
    week: string;
    fileName?: string | null;
    items: Array<{
      tabId: string;
      category?: string;
      columns: string[];
      rows: string[][];
      sheetName?: string | null;
      location?: string | null;
    }>;
  }) =>
    request<{ saved: Array<{ tabId: string; category: string; rows: number }> }>(
      "/api/reports/bulk",
      {
        method: "PUT",
        body: JSON.stringify(body),
      },
    ),
};
