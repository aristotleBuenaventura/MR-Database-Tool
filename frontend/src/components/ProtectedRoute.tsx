import { Navigate, Outlet } from "react-router-dom";
import { homePathForRole, useAuth } from "../auth/AuthContext";

function LoadingShell() {
  return (
    <div className="login-shell">
      <main className="login-content">
        <section className="panel narrow">
          <p className="lede">Loading session...</p>
        </section>
      </main>
    </div>
  );
}

export function ProtectedRoute() {
  const { user, loading } = useAuth();

  if (loading) {
    return <LoadingShell />;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}

/** Master Reports — viewer, admin, and superadmin. */
export function ReportsRoute() {
  const { user, loading } = useAuth();

  if (loading) {
    return <LoadingShell />;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}

/** Admin Dashboard — superadmin only (admins cannot enter). */
export function SuperadminRoute() {
  const { user, loading } = useAuth();

  if (loading) {
    return <LoadingShell />;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (user.role !== "superadmin") {
    return <Navigate to="/dashboard" replace />;
  }

  return <Outlet />;
}

export function GuestRoute() {
  const { user, loading } = useAuth();

  if (loading) {
    return <LoadingShell />;
  }

  if (user) {
    return <Navigate to={homePathForRole(user.role)} replace />;
  }

  return <Outlet />;
}
