import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (client) return client;
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!url || !anon) {
    throw new Error(
      "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY — copy .env.example to .env and fill in your Supabase project.",
    );
  }
  client = createClient(url, anon);
  return client;
}
