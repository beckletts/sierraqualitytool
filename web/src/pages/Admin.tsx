import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useIsAdmin } from "../lib/useIsAdmin";
import type { AdminUserRow } from "../lib/types";
import { AppNav } from "../components/AppNav";
import { SourceProbePanel } from "../components/SourceProbePanel";

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

      {/* Source reachability leads the page: when the queue shows claims as
          unverified, this is the section that says whose problem that is. */}
      <section className="admin-section">
        <h2>Knowledge source reachability</h2>
        <SourceProbePanel />
      </section>

      <section className="admin-section">
        <h2>Access</h2>
        <p className="muted-note">Accounts with access to this tool, and when they last signed in. Visible only to you.</p>

        {error && <p className="error-text">{error}</p>}
        {!error && users === null && <p>Loading...</p>}
        {!error && users && (
          <table className="queue-table">
            <thead>
              <tr>
                <th scope="col">Email</th>
                <th scope="col">Created</th>
                <th scope="col">Last sign-in</th>
                <th scope="col">Email confirmed</th>
                <th scope="col">Status</th>
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
      </section>
    </div>
  );
}
