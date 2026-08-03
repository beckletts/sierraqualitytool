import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// No generated Database types yet (schema is hand-written SQL, not codegen'd) — untyped client.
let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url) throw new Error("SUPABASE_URL is not set");
    if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
    client = createClient(url, key, { auth: { persistSession: false } });
  }
  return client;
}
