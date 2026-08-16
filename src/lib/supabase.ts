// Supabase client — accounts and cross-device sync.
//
// Gated on env, the same way the Google button and the review proxy are: with
// no VITE_SUPABASE_* set the app runs exactly as it did before, on local
// device accounts, and nothing on screen looks broken. Set both vars and the
// real backend takes over.
//
// The anon key is meant to ship in the browser. It is not a secret and it is
// not a back door: every table is under row-level security (supabase/schema.sql),
// so this key can only ever read or write rows belonging to the signed-in user.
// Never put the service-role key in this file or in any VITE_ var — that one
// bypasses RLS entirely.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const URL: string = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "";
const ANON: string = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? "";

export const cloudEnabled = URL.length > 0 && ANON.length > 0;

export const supabase: SupabaseClient | null = cloudEnabled
  ? createClient(URL, ANON, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // The OAuth redirect comes back with the tokens in the URL hash, and
        // this app is hash-routed — let the SDK consume them before our
        // router ever sees that hash.
        detectSessionInUrl: true,
      },
    })
  : null;
