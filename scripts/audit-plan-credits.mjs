import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const env={};readFileSync(resolve(here,"..",".env.local"),"utf-8").split("\n").forEach(l=>{const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)env[m[1]]=m[2].replace(/^["']|["']$/g,"")});
const sb=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});

// 1. Look up Azman Hadi's profile + recent credit ledger
const {data:profs} = await sb.from("profiles").select("*").ilike("email","%azmanhaditeam%").limit(2);
console.log("=== Azman profile ===");
for (const p of (profs||[])) {
  console.log(JSON.stringify({email:p.email, plan:p.plan, credits:p.credits, referred_by:p.referred_by, created_at:p.created_at}, null, 2));
}

// 2. Plan config from app_settings
const {data:planRows} = await sb.from("app_settings").select("key,value").like("key","plan_%");
console.log("\n=== Plans in app_settings ===");
for (const r of (planRows||[])) console.log(`  ${r.key} = ${JSON.stringify(r.value)}`);

// 3. Affiliate / signup credit configs
const {data:signupRows} = await sb.from("app_settings").select("key,value").or("key.like.%credit%,key.like.%signup%,key.like.%affiliate%,key.like.%welcome%");
console.log("\n=== Signup / affiliate / welcome credit settings ===");
for (const r of (signupRows||[])) console.log(`  ${r.key} = ${JSON.stringify(r.value)}`);

// 4. Find Azman's credit transactions (ledger)
if (profs?.[0]) {
  const {data:txn} = await sb.from("credit_ledger").select("*").eq("user_id", profs[0].id).order("created_at",{ascending:false}).limit(20);
  console.log("\n=== Azman credit transactions ===");
  for (const t of (txn||[])) console.log(`  ${t.created_at?.slice(0,19)} ${t.delta>0?"+":""}${t.delta} reason=${t.reason} note=${(t.note||"").slice(0,60)}`);
}

// 5. Find payments for Azman
if (profs?.[0]) {
  const {data:pay} = await sb.from("payments").select("*").eq("user_id", profs[0].id).order("created_at",{ascending:false}).limit(5);
  console.log("\n=== Azman payments ===");
  for (const p of (pay||[])) console.log(`  ${p.created_at?.slice(0,19)} amount=RM${p.amount_myr} ${p.purpose||p.kind||""} status=${p.status||"-"} credits_added=${p.credits_added||0}`);
}
