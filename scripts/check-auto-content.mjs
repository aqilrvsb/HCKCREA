import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const env={};readFileSync(resolve(here,"..",".env.local"),"utf-8").split("\n").forEach(l=>{const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)env[m[1]]=m[2].replace(/^["']|["']$/g,"")});
const sb=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});

// Find latest 6 auto-content rows
const {data} = await sb.from("history").select("id,status,task_id,metadata,created_at").eq("tab","auto-content").order("created_at",{ascending:false}).limit(6);
for (const r of (data||[])) {
  const tlog = r.metadata?.tier_log || [];
  const t1 = tlog[0] || {};
  console.log(`${r.id.slice(0,8)} status=${r.status} provider=${r.metadata?.provider||"-"} slot_meta=${r.metadata?.slot||"(none)"} tier1=${t1.tier||"-"}`);
  console.log(`  task_id=${r.task_id} created=${r.created_at.slice(11,19)}`);
}
