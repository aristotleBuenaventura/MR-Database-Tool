export type Role = "viewer" | "admin" | "superadmin";

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
  isSuperadmin: boolean;
  canManageUsers: boolean;
  mustSetup2fa: boolean;
  totpEnabled: boolean;
};

export type ActiveSession = {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  ipAddress: string | null;
  userAgent: string | null;
  online: boolean;
};

export type ManagedUser = User & {
  updatedAt?: string;
  online: boolean;
  activeSessions: ActiveSession[];
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

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: "include",
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

export type LoginResult =
  | {
      requires2fa: true;
      challengeToken: string;
    }
  | {
      requires2fa?: false;
      user: User;
      capabilities: Capabilities;
    };

export const api = {
  health: () => request<{ status: string; service: string; timestamp: string }>("/api/health"),
  login: (body: { email: string; password: string }) =>
    request<LoginResult>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  verify2fa: (body: { challengeToken: string; code: string }) =>
    request<{ user: User; capabilities: Capabilities }>("/api/auth/2fa/verify", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  setup2fa: () =>
    request<{ secret: string; otpauthUrl: string }>("/api/auth/2fa/setup", {
      method: "POST",
    }),
  enable2fa: (code: string) =>
    request<{ ok: boolean; capabilities: Capabilities }>("/api/auth/2fa/enable", {
      method: "POST",
      body: JSON.stringify({ code }),
    }),
  logout: () =>
    request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  me: () =>
    request<{
      user: User;
      capabilities: Capabilities;
    }>("/api/auth/me"),
  listUsers: () =>
    request<{ users: ManagedUser[] }>("/api/users"),
  createUser: (body: {
    email: string;
    password: string;
    name?: string;
    role: "viewer" | "admin";
  }) =>
    request<{ user: User }>("/api/users", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  changeUserPassword: (id: number, password: string) =>
    request<{ ok: boolean }>(`/api/users/${id}/password`, {
      method: "PATCH",
      body: JSON.stringify({ password }),
    }),
  forceLogoutUser: (id: number) =>
    request<{ ok: boolean; revoked: number }>(`/api/users/${id}/logout`, {
      method: "POST",
    }),
  forceLogoutSession: (sessionId: string) =>
    request<{ ok: boolean }>(`/api/users/sessions/${sessionId}/logout`, {
      method: "POST",
    }),
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
  getReportsByTab: (params: { marketId: string; tabId: string }) => {
    const query = new URLSearchParams({
      marketId: params.marketId,
      tabId: params.tabId,
    });
    return request<{ datasets: ReportDataset[] }>(`/api/reports/tab?${query}`);
  },
  getWeeks: (params: { marketId: string }) => {
    const query = new URLSearchParams({ marketId: params.marketId });
    return request<{ weeks: string[] }>(`/api/reports/weeks?${query}`);
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
    historyLabel?: string | null;
    historyAction?: "import" | "edit";
    items: Array<{
      tabId: string;
      week?: string;
      category?: string;
      columns: string[];
      rows: string[][];
      sheetName?: string | null;
      location?: string | null;
    }>;
  }) =>
    request<{
      saved: Array<{ tabId: string; category: string; week?: string; rows: number }>;
      historyId?: number | null;
    }>("/api/reports/bulk", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  getReportHistory: (params: {
    marketId: string;
    page?: number;
    pageSize?: number;
  }) => {
    const query = new URLSearchParams({
      marketId: params.marketId,
      page: String(params.page ?? 1),
      pageSize: String(params.pageSize ?? 20),
    });
    return request<{
      histories: ReportHistoryEntry[];
      page: number;
      pageSize: number;
      total: number;
      totalPages: number;
    }>(`/api/reports/history?${query}`);
  },
  getReportHistoryDetail: (id: number) =>
    request<{ history: ReportHistoryDetail }>(`/api/reports/history/${id}`),
  restoreReportHistory: (id: number) =>
    request<{ restored: number; historyId: number | null }>(
      `/api/reports/history/${id}/restore`,
      { method: "POST" },
    ),
  purgeReports: (body: {
    marketId: string;
    scope: "tab" | "week";
    tabId?: string;
    week?: string;
    password: string;
  }) =>
    request<{ deleted: number; historyId: number | null }>(
      "/api/reports/purge",
      { method: "POST", body: JSON.stringify(body) },
    ),
  listBackups: (params: { marketId: string }) => {
    const query = new URLSearchParams({ marketId: params.marketId });
    return request<{
      backups: BackupEntry[];
      schedule: BackupSchedule;
      timeZone: string;
    }>(`/api/backups?${query}`);
  },
  createBackup: (body: { marketId: string; label?: string }) =>
    request<{ backup: BackupEntry }>("/api/backups", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  restoreBackup: (id: number) =>
    request<{ restored: number }>(`/api/backups/${id}/restore`, {
      method: "POST",
    }),
  deleteBackup: (id: number) =>
    request<{ deleted: boolean }>(`/api/backups/${id}`, { method: "DELETE" }),
  updateBackupSchedule: (body: {
    enabled?: boolean;
    time?: string;
    retention?: number;
  }) =>
    request<{ schedule: BackupSchedule; timeZone: string }>(
      "/api/backups/schedule",
      { method: "PUT", body: JSON.stringify(body) },
    ),
};

export type BackupEntry = {
  id: number;
  marketId: string;
  label: string;
  trigger: "manual" | "scheduled" | string;
  itemCount: number;
  rowCount: number;
  userEmail?: string | null;
  userName?: string | null;
  createdAt: string;
};

export type BackupSchedule = {
  enabled: boolean;
  time: string;
  retention: number;
  lastRunDate: string | null;
};

export type ReportHistoryEntry = {
  id: number;
  marketId: string;
  action: string;
  label: string;
  weeks: string;
  fileName: string | null;
  userId: number | null;
  userEmail: string | null;
  userName: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  itemCount: number;
  createdAt: string;
};

export type ReportHistoryDetail = ReportHistoryEntry & {
  items: Array<{
    id: number;
    week: string;
    tabId: string;
    category: string;
    fileName: string | null;
    sheetName: string | null;
    location: string | null;
    columns: string[];
    rows: string[][];
    rowCount: number;
  }>;
};
