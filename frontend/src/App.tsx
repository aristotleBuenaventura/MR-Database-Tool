import { Navigate, Route, Routes } from "react-router-dom";
import {
  GuestRoute,
  ReportsRoute,
  SuperadminRoute,
} from "./components/ProtectedRoute";
import { AdminDashboardPage } from "./pages/AdminDashboardPage";
import { LoginPage } from "./pages/LoginPage";
import { MasterReportsPage } from "./pages/MasterReportsPage";

function LoginLayout() {
  return (
    <div className="login-shell">
      <header className="login-topbar">
        <span className="brand">MR Database Tool</span>
      </header>
      <main className="login-content">
        <LoginPage />
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
        <Route path="login" element={<LoginLayout />} />
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
