import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const env={};readFileSync(resolve(here,"..",".env.local"),"utf-8").split("\n").forEach(l=>{const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)env[m[1]]=m[2].replace(/^["']|["']$/g,"")});
const sb=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});

const azmanId="7b6fe928-5204-4e61-819c-0c7a37a9da66";
const {data:pay} = await sb.from("payments").select("*").eq("user_id", azmanId);
console.log("=== Azman payment full ===");
for (const p of (pay||[])) console.log(JSON.stringify(p, null, 2));

const {data:tx} = await sb.from("credit_transactions").select("*").eq("user_id", azmanId).order("created_at",{ascending:false});
console.log("\n=== credit_transactions ===");
for (const t of (tx||[])) console.log(JSON.stringify(t, null, 2));
