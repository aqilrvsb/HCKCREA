import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const env={};readFileSync(resolve(here,"..",".env.local"),"utf-8").split("\n").forEach(l=>{const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)env[m[1]]=m[2].replace(/^["']|["']$/g,"")});
const sb=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const {error}=await sb.from("app_settings").upsert({
  key:"gen_provider_seedance",
  value:{provider:"p1"},
  description:"Cinema/Seedance routing — locked to P1 (GeminiGen). No cascade fallback.",
  category:"provider",
},{onConflict:"key"});
console.log(error?`FAIL: ${error.message}`:"OK gen_provider_seedance = p1");
