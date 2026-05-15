import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const env={};readFileSync(resolve(here,"..",".env.local"),"utf-8").split("\n").forEach(l=>{const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)env[m[1]]=m[2].replace(/^["']|["']$/g,"")});
const sb=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});

// Link the 9 QA test rows + the 3 Talking Object parents + their image children to project NUR (e6ab3775)
const NUR = "e6ab3775";
const {data: full} = await sb.from("projects").select("id").eq("user_id","f0fd6781-ed5f-4aa8-a5b9-eec943229092").ilike("name","NUR").maybeSingle();
const projectId = full?.id;
if (!projectId) { console.error("NUR project not found"); process.exit(1); }

const ids = [
  "4747df7c-dc7f-4e37-90b9-cd880aedb79f","2fe660e9-9b69-4060-b398-5330f3b841c2","1846fa44-a347-4baf-9b02-8625229634ab",
  "9b39be1b-cfac-46b0-b1a6-6cf3ee018c53","072ce506-fb8f-4879-a1cf-6338e8a15dd7","930e9934-b46d-43d2-8904-08d227b4cb28",
  "a6619260-d82d-4e71-8418-936d5d5d36dc","b0e4be87-f019-43d1-b4c5-27e51ec82bac","a655ec25-74b0-474b-95f3-9a009476909d",
  "2222b0e3-d378-41ef-899f-c572fee47c83","5f864a60-9900-469a-87d4-d0aaf965bc4e","6a85d160-5487-4472-9f59-1998cf0d8f90",
];
const {error,count} = await sb.from("history").update({project_id:projectId},{count:"exact"}).in("id",ids);
console.log(error?`FAIL ${error.message}`:`OK assigned ${count} rows to project NUR (${projectId})`);
