/** Superadmin-only UI preview while using Master Reports. */
export type SuperadminReportsView = "admin" | "viewer";

const STORAGE_KEY = "mr_sa_reports_view";

export function getSuperadminReportsView(): SuperadminReportsView {
  try {
    const value = sessionStorage.getItem(STORAGE_KEY);
    return value === "viewer" ? "viewer" : "admin";
  } catch {
    return "admin";
  }
}

export function setSuperadminReportsView(view: SuperadminReportsView) {
  try {
    sessionStorage.setItem(STORAGE_KEY, view);
  } catch {
    // ignore
  }
}

export function openSuperadminReports(view: SuperadminReportsView) {
  setSuperadminReportsView(view);
}
