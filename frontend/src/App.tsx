import { Navigate, Route, Routes } from "react-router-dom";
import { GuestRoute, ProtectedRoute } from "./components/ProtectedRoute";
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
        <Route
          path="login"
          element={
            <LoginLayout />
          }
        />
      </Route>

      <Route element={<ProtectedRoute />}>
        <Route path="dashboard" element={<MasterReportsPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
