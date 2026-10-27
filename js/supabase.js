// One shared Supabase client. Import { db } anywhere.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.114.0/+esm";
import { CONFIG } from "./config.js";

export const db = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});
