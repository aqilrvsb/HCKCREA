const id = process.argv[2];
const u = `https://${id}-${id}.runsync.novita.dev`;
const t0 = Date.now();
const ping = async () => { try { const c=new AbortController(); const t=setTimeout(()=>c.abort(),10000); const r=await fetch(u+"/ping",{signal:c.signal}); clearTimeout(t); return r.status; } catch(e){ return e.name; } };
console.log(`t0 cold-boot start ${id}`);
const deadline = t0 + 25*60*1000;
let n=0;
while (Date.now() < deadline) {
  const s = await ping();
  const el = Math.round((Date.now()-t0)/1000);
  if (++n % 4 === 0 || s === 200) console.log(`+${el}s ping=${s}`);
  if (s === 200) {
    // confirm /avatars too
    try { const r=await fetch(u+"/avatars"); console.log(`BOOTED in ${el}s (~${(el/60).toFixed(1)}min), /avatars=${r.status}`); } catch{ console.log(`BOOTED in ${el}s`); }
    process.exit(0);
  }
  await new Promise(r=>setTimeout(r,15000));
}
console.log("BOOT_TIMEOUT_25MIN"); process.exit(2);
