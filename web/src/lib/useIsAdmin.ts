import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import { useAuth } from "./auth";

/** null while the check is in flight, so callers don't flash "not admin" before it resolves. */
export function useIsAdmin(): boolean | null {
  const { session } = useAuth();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    if (!session) {
      setIsAdmin(false);
      return;
    }
    setIsAdmin(null);
    void (async () => {
      const { data, error } = await supabase.rpc("am_i_admin");
      setIsAdmin(error ? false : Boolean(data));
    })();
  }, [session]);

  return isAdmin;
}
