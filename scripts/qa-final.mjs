import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const env={};readFileSync(resolve(here,"..",".env.local"),"utf-8").split("\n").forEach(l=>{const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)env[m[1]]=m[2].replace(/^["']|["']$/g,"")});
const sb=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});

const groups = {
  "Image (3)": ["4747df7c-dc7f-4e37-90b9-cd880aedb79f","2fe660e9-9b69-4060-b398-5330f3b841c2","1846fa44-a347-4baf-9b02-8625229634ab"],
  "Storytelling (3)": ["9b39be1b-cfac-46b0-b1a6-6cf3ee018c53","072ce506-fb8f-4879-a1cf-6338e8a15dd7","930e9934-b46d-43d2-8904-08d227b4cb28"],
  "UGC Video (3) — after manual retry": ["a6619260-d82d-4e71-8418-936d5d5d36dc","b0e4be87-f019-43d1-b4c5-27e51ec82bac","a655ec25-74b0-474b-95f3-9a009476909d"],
  "Talking Object (3 parents)": ["2222b0e3-d378-41ef-899f-c572fee47c83","5f864a60-9900-469a-87d4-d0aaf965bc4e","6a85d160-5487-4472-9f59-1998cf0d8f90"],
};

for (const [tab, ids] of Object.entries(groups)) {
  console.log(`\n=== ${tab} ===`);
  for (const id of ids) {
    const {data} = await sb.from("history").select("id,status,task_id,metadata,error_message,output_url,retry_count:metadata->retry_count").eq("id",id).maybeSingle();
    if (!data) { console.log(`  ${id.slice(0,8)} NOT FOUND`); continue; }
    const tlog = data.metadata?.tier_log || [];
    const last = tlog[tlog.length-1] || {};
    const retries = data.metadata?.retry_count || 0;
    const out = data.output_url ? "B2 ✓" : "no url";
    console.log(`  ${id.slice(0,8)} status=${data.status.padEnd(8)} prov=${(data.metadata?.provider||"-").padEnd(5)} retries=${retries} ${out}  tier_last=${last.tier||"-"} ok=${last.ok}  err=${(data.error_message||"").slice(0,40)}`);
  }
}

// Also find Talking Object child image rows
console.log("\n=== Talking Object — IMAGE child rows ===");
const toParents = ["2222b0e3-d378-41ef-899f-c572fee47c83","5f864a60-9900-469a-87d4-d0aaf965bc4e","6a85d160-5487-4472-9f59-1998cf0d8f90"];
for (const pid of toParents) {
  const {data: children} = await sb.from("history").select("id,status,metadata,error_message").contains("metadata", {parent_video_history_id: pid}).limit(3);
  for (const c of (children||[])) {
    const tlog = c.metadata?.tier_log || [];
    const t1 = tlog[0]||{};
    console.log(`  parent=${pid.slice(0,8)} child=${c.id.slice(0,8)} status=${c.status} prov=${c.metadata?.provider||"-"} tier1=${t1.tier||"-"}  err=${(c.error_message||"").slice(0,40)}`);
  }
}

// Counters
console.log("\n=== Rotation counters ===");
const {data: counters} = await sb.from("app_settings").select("key,value").in("key",["image_rotation_counter","video_rotation_counter"]);
console.log(JSON.stringify(counters, null, 2));
