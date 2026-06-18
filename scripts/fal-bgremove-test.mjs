import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = {};
for (const l of readFileSync(".env.local","utf8").split("\n")){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);if(m)env[m[1]]=m[2].replace(/^["']|["']$/g,"");}
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const clean=(v)=>{let s=v;if(typeof s==="string"){try{const p=JSON.parse(s);return p.key||p.url||p.path||s;}catch{}return s.replace(/^"+|"+$/g,"");}return v?.key||v?.url||v;};
const { data } = await sb.from("app_settings").select("value").eq("key","fal_key").single();
const KEY = clean(data.value);
const VIDEO = "https://peninglab-content.s3.us-east-005.backblazeb2.com/users/5c102586-f32b-4151-abb7-65b953788bce/ugc/59e7ba7c-6bd2-41c5-8e5b-cf2d40b38c3f.mp4";
const MODEL = "fal-ai/bria/video/background-removal";
const H = { "Authorization": `Key ${KEY}`, "Content-Type":"application/json" };
console.log("submit →", MODEL);
let r = await fetch(`https://queue.fal.run/${MODEL}`, { method:"POST", headers:H, body: JSON.stringify({ video_url: VIDEO }) });
let j = await r.json().catch(()=>({}));
console.log("submit status", r.status, JSON.stringify(j).slice(0,300));
const reqId = j.request_id;
if(!reqId){ console.log("NO request_id — model id or input wrong"); process.exit(1); }
const statusUrl = `https://queue.fal.run/${MODEL}/requests/${reqId}/status`;
const resUrl = `https://queue.fal.run/${MODEL}/requests/${reqId}`;
const t0=Date.now();
while(Date.now()-t0 < 300000){
  await new Promise(x=>setTimeout(x,8000));
  const s = await (await fetch(statusUrl,{headers:H})).json().catch(()=>({}));
  console.log(`+${Math.round((Date.now()-t0)/1000)}s`, s.status);
  if(s.status==="COMPLETED"){
    const out = await (await fetch(resUrl,{headers:H})).json().catch(()=>({}));
    console.log("RESULT:", JSON.stringify(out).slice(0,500));
    const url = out?.video?.url || out?.url || out?.image?.url;
    if(url){ const h = await fetch(url,{method:"HEAD"}); console.log("OUTPUT URL:", url); console.log("content-type:", h.headers.get("content-type"), "size:", h.headers.get("content-length")); }
    process.exit(0);
  }
  if(s.status==="FAILED"||s.status==="ERROR"){ console.log("FAILED", JSON.stringify(s).slice(0,300)); process.exit(1); }
}
console.log("TIMEOUT 5min");
