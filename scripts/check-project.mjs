import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const env={};readFileSync(resolve(here,"..",".env.local"),"utf-8").split("\n").forEach(l=>{const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)env[m[1]]=m[2].replace(/^["']|["']$/g,"")});
const sb=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});

// Get test rows
const ids = ["4747df7c-dc7f-4e37-90b9-cd880aedb79f","2fe660e9-9b69-4060-b398-5330f3b841c2","1846fa44-a347-4baf-9b02-8625229634ab","9b39be1b-cfac-46b0-b1a6-6cf3ee018c53","072ce506-fb8f-4879-a1cf-6338e8a15dd7","930e9934-b46d-43d2-8904-08d227b4cb28","a6619260-d82d-4e71-8418-936d5d5d36dc","b0e4be87-f019-43d1-b4c5-27e51ec82bac","a655ec25-74b0-474b-95f3-9a009476909d"];
const {data} = await sb.from("history").select("id,user_id,project_id,type,tab,status,output_url").in("id",ids);
for (const r of (data||[])) {
  console.log(`${r.id.slice(0,8)} user=${r.user_id.slice(0,8)} project=${r.project_id||"null"} type=${r.type} tab=${r.tab} status=${r.status} has_url=${!!r.output_url}`);
}

// Find what projects this user has
const {data: projs} = await sb.from("projects").select("id,name,created_at").eq("user_id","f0fd6781-ed5f-4aa8-a5b9-eec943229092").order("created_at",{ascending:false}).limit(5);
console.log("\nUser's projects:");
for (const p of (projs||[])) console.log(`  ${p.id.slice(0,8)} name=${p.name}`);
