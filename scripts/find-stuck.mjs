import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const env={};readFileSync(resolve(here,"..",".env.local"),"utf-8").split("\n").forEach(l=>{const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)env[m[1]]=m[2].replace(/^["']|["']$/g,"")});
const sb=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});

// Look up the row with that specific task_id
const taskId = "fb9fc3a0-60de-4948-8986-ea90e3aafb57";
const {data} = await sb.from("history").select("id,status,task_id,metadata,error_message,created_at,updated_at,tab,type").eq("task_id", taskId).maybeSingle();
if (!data) {
  console.log(`No row found with task_id=${taskId}`);
  console.log("\nMost recent pending rows:");
  const {data:rec} = await sb.from("history").select("id,status,task_id,tab,metadata,created_at,updated_at").eq("status","pending").order("created_at",{ascending:false}).limit(5);
  for (const r of (rec||[])) {
    const age = Math.round((Date.now() - new Date(r.created_at).getTime())/60_000);
    const updAge = Math.round((Date.now() - new Date(r.updated_at).getTime())/60_000);
    console.log(`  ${r.id.slice(0,8)} tab=${r.tab} task_id=${r.task_id} provider=${r.metadata?.provider} age=${age}m updated=${updAge}m ago`);
  }
} else {
  console.log(JSON.stringify(data, null, 2));
}
