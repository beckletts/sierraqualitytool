import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useIsAdmin } from "../lib/useIsAdmin";
import type { AdminUserRow } from "../lib/types";
import { AppNav } from "../components/AppNav";

export function Admin() {
  const isAdmin = useIsAdmin();
  const [users, setUsers] = useState<AdminUserRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    void (async () => {
      const { data, error } = await supabase.rpc("admin_list_users");
      if (error) setError(error.message);
      else setUsers((data ?? []) as AdminUserRow[]);
    })();
  }, [isAdmin]);

  if (isAdmin === null) return <div className="page-shell">Loading...</div>;
  if (isAdmin === false) return <Navigate to="/" replace />;

  return (
    <div className="page-shell">
      <header className="page-header">
        <h1>Admin</h1>
        <AppNav />
      </header>

      <p className="muted-note">Accounts with access to this tool, and when they last signed in. Visible only to you.</p>

      {error && <p className="error-text">{error}</p>}
      {!error && users === null && <p>Loading...</p>}
      {!error && users && (
        <table className="queue-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Created</th>
              <th>Last sign-in</th>
              <th>Email confirmed</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.email}</td>
                <td>{new Date(u.created_at).toLocaleString()}</td>
                <td>{u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleString() : "Never"}</td>
                <td>{u.email_confirmed_at ? "Yes" : "No"}</td>
                <td>{u.banned_until ? "Suspended" : "Active"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
