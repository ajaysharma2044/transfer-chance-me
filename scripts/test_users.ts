// Create / delete / list test accounts against live Supabase via the admin API
// (service-role key). Test accounts only (tcm-test+<n>@…), created confirmed so
// email verification isn't a blocker. Usage:
//   npx vite-node scripts/test_users.ts create tcm-test+verify1@example.com <password>
//   npx vite-node scripts/test_users.ts delete tcm-test+verify1@example.com
//   npx vite-node scripts/test_users.ts list

import { loadEnvLocal } from "./_loadenv";
loadEnvLocal();
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
if (!url || !serviceKey) { console.log("missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY"); process.exit(1); }

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

async function findByEmail(email: string) {
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  return data.users.find((u) => u.email === email) ?? null;
}

const cmd = process.argv[2];
(async () => {
  if (cmd === "create") {
    const email = process.argv[3];
    const password = process.argv[4];
    if (!email || !password) { console.log("usage: create <email> <password>"); process.exit(1); }
    if (!email.startsWith("tcm-test+")) { console.log("refusing: test accounts must start with tcm-test+"); process.exit(1); }
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) { console.log("create error:", error.message); process.exit(1); }
    console.log("created+confirmed:", data.user?.email, "| id:", data.user?.id);
  } else if (cmd === "delete") {
    const email = process.argv[3];
    if (!email?.startsWith("tcm-test+")) { console.log("refusing: only tcm-test+ accounts"); process.exit(1); }
    const u = await findByEmail(email);
    if (!u) { console.log("not found:", email); return; }
    const { error } = await admin.auth.admin.deleteUser(u.id);
    console.log(error ? "delete error: " + error.message : "deleted: " + email + " | id:" + u.id);
  } else if (cmd === "list") {
    const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
    if (error) { console.log("list error:", error.message); process.exit(1); }
    console.log("tcm-test users:", data.users.filter((u) => (u.email || "").startsWith("tcm-test+")).map((u) => u.email));
  } else {
    console.log("usage: create <email> <password> | delete <email> | list");
  }
})().catch((e) => { console.log("error:", (e as Error).message); process.exit(1); });
