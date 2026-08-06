import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useIsAdmin } from "../lib/useIsAdmin";

export function AppNav() {
  const { signOut } = useAuth();
  const isAdmin = useIsAdmin();

  return (
    <nav className="header-nav">
      <Link to="/">Queue</Link>
      <Link to="/insights">Insights</Link>
      <Link to="/settings">Settings</Link>
      {isAdmin && <Link to="/admin">Admin</Link>}
      <button className="link-button" onClick={() => void signOut()}>
        Sign out
      </button>
    </nav>
  );
}
