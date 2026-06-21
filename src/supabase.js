import { createClient } from "@supabase/supabase-js";

// .env (raíz del proyecto Vite):
//   VITE_SUPABASE_URL=https://xxxx.supabase.co
//   VITE_SUPABASE_ANON_KEY=eyJhb...
const url = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anon) {
  console.warn("[Agenda] Faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY en tu .env");
}

export const supabase = createClient(url, anon);
