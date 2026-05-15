import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const env={};readFileSync(resolve(here,"..",".env.local"),"utf-8").split("\n").forEach(l=>{const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)env[m[1]]=m[2].replace(/^["']|["']$/g,"")});
const sb=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});

const ids = ["4747df7c-dc7f-4e37-90b9-cd880aedb79f","9b39be1b-cfac-46b0-b1a6-6cf3ee018c53","a6619260-d82d-4e71-8418-936d5d5d36dc"];
for (const id of ids) {
  const {data} = await sb.from("history").select("id,user_id,type,tab,status,created_at,dismissed_from_extension").eq("id",id).maybeSingle();
  console.log(id.slice(0,8), "→", JSON.stringify({user_id:data?.user_id,type:data?.type,tab:data?.tab,status:data?.status,dismissed:data?.dismissed_from_extension,created:data?.created_at}));
}

// Also resolve the user_id to email
const {data: prof} = await sb.from("profiles").select("id,email,full_name").eq("id","f0fd6781-ed5f-4aa8-a5b9-eec943229092").maybeSingle();
console.log("\nOwner profile:", JSON.stringify(prof));
