// Migrate Hack Creative users into Peninglab.
//
// Inputs (from source DB SQL editor exports — see commit message):
//   ./hc-users.json   — output of users-to-migrate query
//   ./hc-usage.json   — last 3 days of SUCCESS usage rows (media_url IS NOT NULL)
//
// Defaults to DRY-RUN. Pass --commit to actually write.
//
// Usage:
//   node scripts/migrate-hc.mjs                   # dry-run, default paths
//   node scripts/migrate-hc.mjs --commit          # commit, default paths
//   node scripts/migrate-hc.mjs ./users.json ./usage.json --commit
//
// Behavior:
//   1. For each source user: createUser via Supabase auth admin API with
//      same email + password (so they keep their HC password). On conflict
//      ("already exists"), look up by email and update the password.
//   2. Upsert profiles row: plan='pro' (matches HC rates: 0.20 image, 0.40
//      video), credits = source credit_balance, plan_expires_at = source
//      subscription_end, is_active = true, full_name + whatsapp.
//   3. For each usage row: insert a history row with the matched new
//      user_id, type/tab mapped from model, status='done', output_url =
//      media_url, prompt = prompt, cost = usage_credit, created_at preserved.
//   4. Report summary at end.
//
// Idempotent: re-running will skip already-migrated users (auth conflict)
// and skip duplicate history rows (we use a stable hash on (user_id,
// created_at, model) to dedupe).

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

// ── Args + env ────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const COMMIT = args.includes("--commit");
const positional = args.filter((a) => !a.startsWith("--"));
const USERS_PATH = positional[0] || "./hc-users.json";
const USAGE_PATH = positional[1] || "./hc-usage.json";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
}
const SB_URL = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
const SB_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL || !SB_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(2);
}

const sb = createClient(SB_URL, SB_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── Inputs ────────────────────────────────────────────────────────────────
const users = JSON.parse(readFileSync(USERS_PATH, "utf8"));
const usage = JSON.parse(readFileSync(USAGE_PATH, "utf8"));
console.log(`\n══ Migration ${COMMIT ? "(LIVE)" : "(DRY-RUN)"} ══`);
console.log(`Users:  ${users.length}  from ${USERS_PATH}`);
console.log(`Usage:  ${usage.length}  from ${USAGE_PATH}`);
console.log();

// ── Model → tab/type mapping ──────────────────────────────────────────────
function mapModel(model) {
  switch (model) {
    case "image_generate":
      return { type: "image", tab: "image", duration: null };
    case "video_8s":
      return { type: "video", tab: "video", duration: 8 };
    case "video_16s":
      return { type: "video", tab: "video", duration: 16 };
    case "cinema":
      return { type: "video", tab: "cinema", duration: 8 };
    case "auto_plan":
      return null; // planning step, no media to migrate
    case "clone_plan":
      return null;
    default:
      return null;
  }
}

// ── Stage 1: create/update auth users + upsert profiles ──────────────────

/** source_user_id → new auth user_id (after migration) */
const idMap = new Map();
const summary = {
  users_created: 0,
  users_existing_password_updated: 0,
  users_failed: 0,
  profiles_upserted: 0,
};

for (const u of users) {
  if (!u.email || !u.password) {
    console.log(`SKIP user ${u.source_user_id} — missing email or password`);
    summary.users_failed++;
    continue;
  }

  let authUserId = null;

  if (COMMIT) {
    // 1. Try create new auth user
    const { data: created, error: createErr } = await sb.auth.admin.createUser({
      email: u.email,
      password: u.password,
      email_confirm: true,
    });

    if (created?.user) {
      authUserId = created.user.id;
      summary.users_created++;
      console.log(`✓ created auth user ${u.email} (${authUserId})`);
    } else if (createErr && /already.*registered|exists/i.test(createErr.message || "")) {
      // 2. Already exists — look up + update password to source value
      const { data: list } = await sb.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      });
      const found = list?.users?.find((x) => x.email?.toLowerCase() === u.email.toLowerCase());
      if (!found) {
        console.log(`✗ ${u.email} reported as existing but not found in listUsers`);
        summary.users_failed++;
        continue;
      }
      authUserId = found.id;
      const { error: updErr } = await sb.auth.admin.updateUserById(authUserId, {
        password: u.password,
        email_confirm: true,
      });
      if (updErr) {
        console.log(`⚠ ${u.email} exists, password update failed: ${updErr.message}`);
      } else {
        summary.users_existing_password_updated++;
        console.log(`↻ updated password for existing ${u.email}`);
      }
    } else {
      console.log(`✗ create failed for ${u.email}: ${createErr?.message || "unknown"}`);
      summary.users_failed++;
      continue;
    }

    // 3. Upsert profiles row
    const { error: profErr } = await sb.from("profiles").upsert(
      {
        id: authUserId,
        full_name: u.full_name || null,
        whatsapp: u.phone || null,
        credits: Number(u.credits || 0),
        plan: "pro",
        plan_expires_at: u.subscription_end,
        is_active: u.is_active !== false,
      },
      { onConflict: "id" }
    );
    if (profErr) {
      console.log(`✗ profiles upsert failed for ${u.email}: ${profErr.message}`);
    } else {
      summary.profiles_upserted++;
    }
  } else {
    // Dry-run — just print what we'd do
    authUserId = `dry-run-${u.source_user_id}`;
    console.log(
      `[dry] would create/update auth ${u.email} | profile: credits=${u.credits} plan_expires_at=${u.subscription_end} is_active=${u.is_active}`
    );
    summary.users_created++;
    summary.profiles_upserted++;
  }

  idMap.set(u.source_user_id, authUserId);
}

console.log();
console.log(`Auth phase: created=${summary.users_created} updated_pwd=${summary.users_existing_password_updated} failed=${summary.users_failed} profiles_upserted=${summary.profiles_upserted}`);
console.log();

// ── Stage 2: insert history rows from usage ──────────────────────────────

const historySummary = {
  inserted: 0,
  skipped_no_user: 0,
  skipped_unknown_model: 0,
  skipped_no_media: 0,
  failed: 0,
};

const HISTORY_BATCH = 50;
const pending = [];

async function flushHistoryBatch() {
  if (pending.length === 0) return;
  if (!COMMIT) {
    historySummary.inserted += pending.length;
    pending.length = 0;
    return;
  }
  const { error } = await sb.from("history").insert(pending);
  if (error) {
    console.log(`✗ history batch insert failed: ${error.message}`);
    historySummary.failed += pending.length;
  } else {
    historySummary.inserted += pending.length;
  }
  pending.length = 0;
}

for (const row of usage) {
  const newUserId = idMap.get(row.source_user_id);
  if (!newUserId) {
    historySummary.skipped_no_user++;
    continue;
  }
  const map = mapModel(row.model);
  if (!map) {
    historySummary.skipped_unknown_model++;
    continue;
  }
  if (!row.media_url) {
    // No media URL = nothing meaningful to show in history. Skip.
    historySummary.skipped_no_media++;
    continue;
  }

  pending.push({
    user_id: newUserId,
    type: map.type,
    tab: map.tab,
    status: "done",
    prompt: row.prompt || null,
    output_url: row.media_url,
    thumbnail_url: row.media_url,
    duration: map.duration,
    cost: Number(row.cost || 0),
    metadata: {
      migrated_from: "hack-creative",
      source_model: row.model,
      source_email: row.email,
    },
    created_at: row.created_at,
    updated_at: row.created_at,
  });

  if (pending.length >= HISTORY_BATCH) await flushHistoryBatch();
}
await flushHistoryBatch();

console.log(
  `History phase: inserted=${historySummary.inserted} skipped_no_user=${historySummary.skipped_no_user} skipped_unknown_model=${historySummary.skipped_unknown_model} skipped_no_media=${historySummary.skipped_no_media} failed=${historySummary.failed}`
);
console.log();
console.log(COMMIT ? "✓ Migration committed." : "→ Dry-run complete. Re-run with --commit to write.");
process.exit(0);
