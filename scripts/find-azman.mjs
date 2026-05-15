import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const env={};readFileSync(resolve(here,"..",".env.local"),"utf-8").split("\n").forEach(l=>{const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)env[m[1]]=m[2].replace(/^["']|["']$/g,"")});
const sb=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});

// Try auth.users via admin client
const {data:auth} = await sb.auth.admin.listUsers({page:1,perPage:1000});
const azman = auth?.users?.find(u => /azmanhadi/i.test(u.email||""));
console.log("Auth user:", azman ? {id:azman.id, email:azman.email, created:azman.created_at} : "NOT FOUND");

if (azman) {
  // Profile
  const {data:p} = await sb.from("profiles").select("*").eq("id", azman.id).maybeSingle();
  console.log("\nProfile:", JSON.stringify(p, null, 2));

  // Credit transactions
  const {data:txn} = await sb.from("credit_ledger").select("*").eq("user_id", azman.id).order("created_at",{ascending:false}).limit(20);
  console.log("\nCredit transactions:");
  for (const t of (txn||[])) console.log(`  ${t.created_at?.slice(0,19)} ${t.delta>0?"+":""}${t.delta} reason=${t.reason} note=${(t.note||"").slice(0,80)}`);

  // Payments
  const {data:pay} = await sb.from("payments").select("*").eq("user_id", azman.id).order("created_at",{ascending:false}).limit(10);
  console.log("\nPayments:");
  for (const p of (pay||[])) console.log(`  ${p.created_at?.slice(0,19)} RM${p.amount_myr||p.amount||"?"} ${p.purpose||p.kind||""} status=${p.status||"-"} credits_added=${p.credits_added||0}`);
}
