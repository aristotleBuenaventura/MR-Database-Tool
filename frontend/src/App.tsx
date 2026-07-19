import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import {
  GuestRoute,
  ReportsRoute,
  SuperadminRoute,
} from "./components/ProtectedRoute";
import { AdminDashboardPage } from "./pages/AdminDashboardPage";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
import { LoginPage } from "./pages/LoginPage";
import { MasterReportsPage } from "./pages/MasterReportsPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";

function AuthLayout() {
  return (
    <div className="login-shell">
      <header className="login-topbar">
        <div className="login-topbar-inner">
          <div className="brand-lockup">
            <span className="brand-mark" aria-hidden>
              MR
            </span>
            <div className="brand-copy">
              <span className="brand-kicker">MR Database Tool</span>
              <span className="brand">Sign in</span>
            </div>
          </div>
        </div>
      </header>
      <main className="login-content">
        <Outlet />
      </main>
      <span className="mr-credit">Developed by Aris</span>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route element={<GuestRoute />}>
        <Route index element={<Navigate to="/login" replace />} />
        <Route element={<AuthLayout />}>
          <Route path="login" element={<LoginPage />} />
          <Route path="forgot-password" element={<ForgotPasswordPage />} />
          <Route path="reset-password" element={<ResetPasswordPage />} />
        </Route>
      </Route>

      <Route element={<ReportsRoute />}>
        <Route path="dashboard" element={<MasterReportsPage />} />
      </Route>

      <Route element={<SuperadminRoute />}>
        <Route path="admin" element={<AdminDashboardPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
