import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const env={};readFileSync(resolve(here,"..",".env.local"),"utf-8").split("\n").forEach(l=>{const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)env[m[1]]=m[2].replace(/^["']|["']$/g,"")});
const sb=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const now = Date.now();
const ids=["a6619260-d82d-4e71-8418-936d5d5d36dc","b0e4be87-f019-43d1-b4c5-27e51ec82bac","a655ec25-74b0-474b-95f3-9a009476909d"];
for (const id of ids) {
  const {data:r} = await sb.from("history").select("id,status,task_id,output_url,metadata,error_message,updated_at,created_at").eq("id",id).maybeSingle();
  if (!r) continue;
  const tlog = r.metadata?.tier_log || [];
  const ageSec = Math.round((now - new Date(r.created_at).getTime())/1000);
  const sinceUpdate = Math.round((now - new Date(r.updated_at).getTime())/1000);
  console.log(`\n${id.slice(0,8)}`);
  console.log(`  status=${r.status}  provider=${r.metadata?.provider||"-"}  age=${ageSec}s  updated=${sinceUpdate}s ago`);
  console.log(`  task_id=${r.task_id}`);
  console.log(`  retries=${r.metadata?.retry_count||0}  output=${r.output_url?"YES":"no"}`);
  for (const t of tlog) console.log(`  tier ${t.tier} ok=${t.ok} err=${(t.error||"").slice(0,60)}`);
  if (r.error_message) console.log(`  ERR: ${r.error_message.slice(0,100)}`);
}
