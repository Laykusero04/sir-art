import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabaseConfigError =
  url && key ? null : "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY.";

export const supabase = createClient(url || "http://localhost", key || "missing", {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
