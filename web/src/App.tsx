import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/auth";
import { Login } from "./pages/Login";
import { Queue } from "./pages/Queue";
import { TranscriptDetail } from "./pages/TranscriptDetail";
import { Insights } from "./pages/Insights";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) return <div className="page-shell">Loading...</div>;
  if (!session) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <Queue />
            </RequireAuth>
          }
        />
        <Route
          path="/interactions/:id"
          element={
            <RequireAuth>
              <TranscriptDetail />
            </RequireAuth>
          }
        />
        <Route
          path="/insights"
          element={
            <RequireAuth>
              <Insights />
            </RequireAuth>
          }
        />
      </Routes>
    </AuthProvider>
  );
}
