"use client";

// Affiliate roster — the LIST of affiliate contacts + a "New Affiliate" modal.
// Moved here (2026-07-29) from Settings so affiliate management lives ON the
// Reporting Affiliate tab: the list shows inline, and "+ New Affiliate" opens a
// modal to add by NL Staff ID (AFL-###) or bulk-import from NL Affiliate Army.
//
// Storage is identical to the old Settings widget — profiles.settings
// { affiliate_enabled, affiliate_contacts } — so the Editor's Transfer Affiliate
// flow and the reporting below keep reading the same source of truth.

import { useEffect, useState } from "react";
import { Users, Loader2, X, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

// Affiliate contact — keyed by NL "Staff ID" (AFL-###). name + whatsapp come
// from NL Affiliate Army (read-only); affiliate_id is NL's internal id.
type AffContact = { staff_id: string; affiliate_id?: number | string | null; name: string; whatsapp?: string };

export default function AffiliateRoster() {
  const [affEnabled, setAffEnabled] = useState(false);
  const [affContacts, setAffContacts] = useState<AffContact[]>([]);
  const [affStaffId, setAffStaffId] = useState("");
  const [affLooking, setAffLooking] = useState(false);
  const [savingAff, setSavingAff] = useState(false);
  const [affMsg, setAffMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [importingAff, setImportingAff] = useState(false);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const sb = createClient();
        const { data: { user } } = await sb.auth.getUser();
        if (!user) return;
        const { data } = await sb.from("profiles").select("settings").eq("id", user.id).maybeSingle();
        const s = (data?.settings || {}) as any;
        setAffEnabled(!!s.affiliate_enabled);
        setAffContacts(Array.isArray(s.affiliate_contacts) ? s.affiliate_contacts : []);
      } catch { /* keep defaults */ }
    })();
  }, []);

  async function saveAffiliate(nextEnabled: boolean, nextContacts: AffContact[]) {
    setSavingAff(true); setAffMsg(null);
    try {
      const sb = createClient();
      const { data: { user } } = await sb.auth.getUser();
      if (!user) throw new Error("Not signed in");
      const { data: cur } = await sb.from("profiles").select("settings").eq("id", user.id).maybeSingle();
      const merged = { ...(((cur?.settings as any)) || {}), affiliate_enabled: nextEnabled, affiliate_contacts: nextContacts };
      const { error } = await sb.from("profiles").update({ settings: merged }).eq("id", user.id);
      if (error) throw error;
      setAffEnabled(nextEnabled); setAffContacts(nextContacts);
      setAffMsg({ ok: true, text: "Affiliate settings dah update." });
    } catch (e: any) {
      setAffMsg({ ok: false, text: e?.message || "Update failed" });
    } finally { setSavingAff(false); }
  }

  // Add by Staff ID only: look it up in NL Affiliate Army → auto-fill name +
  // WhatsApp. On 404 we refuse to save (an unknown ID would fail the transfer).
  const addAffContact = async () => {
    const sid = affStaffId.trim().toUpperCase();
    if (!sid) { setAffMsg({ ok: false, text: "Masukkan ID Staff (cth AFL-009)." }); return; }
    if (affContacts.some((c) => (c.staff_id || "").toUpperCase() === sid)) { setAffMsg({ ok: false, text: "ID Staff tu dah ada." }); return; }
    setAffLooking(true); setAffMsg(null);
    try {
      const res = await fetch(`/api/affiliate/lookup?staff_id=${encodeURIComponent(sid)}`);
      const d = await res.json().catch(() => null);
      if (res.status === 404) { setAffMsg({ ok: false, text: "ID Staff tak dijumpai dalam NL Affiliate Army." }); return; }
      if (!res.ok || !d?.ok || !d?.affiliate) { setAffMsg({ ok: false, text: d?.error || "Lookup gagal." }); return; }
      const a = d.affiliate;
      const next = [...affContacts, { staff_id: String(a.staff_id || sid), affiliate_id: a.id ?? null, name: String(a.name || sid), whatsapp: String(a.phone || "") }];
      setAffStaffId("");
      await saveAffiliate(affEnabled, next);
      setAffMsg({ ok: true, text: `Ditambah: ${a.name} (${a.staff_id}) · ${a.phone || "tiada no"}` });
    } catch (e: any) {
      setAffMsg({ ok: false, text: e?.message || "Lookup gagal." });
    } finally { setAffLooking(false); }
  };

  const removeAffContact = (sid: string) => void saveAffiliate(affEnabled, affContacts.filter((c) => (c.staff_id || "") !== sid));

  // Pull the whole roster from NL Affiliate Army → fills Staff ID + name +
  // WhatsApp for everyone in one shot. Merges by Staff ID (refresh existing,
  // keep any manual ones not on the roster).
  async function importAffRoster() {
    setImportingAff(true); setAffMsg(null);
    try {
      const res = await fetch("/api/affiliate/roster");
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.ok) { setAffMsg({ ok: false, text: d?.error || "Gagal ambil senarai affiliate." }); return; }
      const incoming: AffContact[] = (d.affiliates || [])
        .map((a: any) => ({ staff_id: String(a.staffId || "").trim(), affiliate_id: a.id ?? null, name: String(a.name || ""), whatsapp: String(a.phone || "") }))
        .filter((a: AffContact) => !!a.staff_id);
      if (!incoming.length) { setAffMsg({ ok: false, text: "Senarai affiliate kosong." }); return; }
      const byId = new Map(affContacts.filter((c) => c.staff_id).map((c) => [c.staff_id, c]));
      for (const a of incoming) byId.set(a.staff_id, a);
      const merged = [...byId.values()];
      await saveAffiliate(affEnabled, merged);
      setAffMsg({ ok: true, text: `Import ${incoming.length} affiliate dari NL Affiliate Army.` });
    } catch (e: any) {
      setAffMsg({ ok: false, text: e?.message || "Import gagal" });
    } finally { setImportingAff(false); }
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      {/* Header — icon + title + enable toggle + New Affiliate */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl" style={{ background: "rgba(139,92,246,0.12)", border: "1px solid rgba(139,92,246,0.3)" }}>
            <Users className="h-4 w-4" style={{ color: "#a78bfa" }} />
          </span>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-white">Senarai Affiliate</div>
            <div className="truncate text-[11px] text-white/45">
              Transfer video ke affiliate (tag + rekod) · {affContacts.length} affiliate
            </div>
          </div>
        </div>
        <button onClick={() => { setAffMsg(null); setShowModal(true); }}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-1.5 text-xs font-bold text-emerald-200 hover:bg-emerald-400/20">
          <Plus className="h-3.5 w-3.5" /> New Affiliate
        </button>
      </div>

      {/* Inline list */}
      {affContacts.length === 0 ? (
        <p className="text-xs text-white/40">Belum ada affiliate. Tekan <b>+ New Affiliate</b> untuk tambah (ID Staff AFL-###) atau Import dari NL Affiliate Army.</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {affContacts.map((c) => (
            <div key={c.staff_id || c.name} className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/30 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-bold text-white">{c.name}</div>
                <div className="truncate text-[11px] text-white/45">
                  <span style={{ color: "#a78bfa", fontWeight: 700 }}>{c.staff_id || "— tiada ID —"}</span>
                  {c.whatsapp ? <span> · 📱 {c.whatsapp}</span> : <span className="text-rose-400"> · tiada no WhatsApp</span>}
                </div>
              </div>
              <button onClick={() => removeAffContact(c.staff_id || "")} disabled={savingAff}
                className="shrink-0 text-rose-400 hover:text-rose-300 disabled:opacity-50" title="Buang affiliate">
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* New Affiliate modal — add by Staff ID + Import. The list above updates
          live as contacts are added (shared state). */}
      {showModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.8)" }} onClick={() => setShowModal(false)}>
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#111] p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <div className="text-sm font-semibold text-white">Tambah Affiliate</div>
              <button onClick={() => setShowModal(false)} className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-white/60 hover:bg-white/10">✕</button>
            </div>
            <div className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row">
                <input className="flex-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/30"
                  placeholder="ID Staff (AFL-###)" value={affStaffId}
                  onChange={(e) => setAffStaffId(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === "Enter" && !affLooking && addAffContact()} />
                <button onClick={() => void addAffContact()} disabled={savingAff || affLooking}
                  className="whitespace-nowrap rounded-lg bg-emerald-500 px-4 py-2 text-sm font-bold text-black hover:bg-emerald-400 disabled:opacity-60">
                  {(savingAff || affLooking) ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
                </button>
              </div>
              <button onClick={() => void importAffRoster()} disabled={importingAff || savingAff}
                className="w-full whitespace-nowrap rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/70 hover:bg-white/10 disabled:opacity-60">
                {importingAff ? <Loader2 className="inline h-3.5 w-3.5 animate-spin" /> : "⤓ Import dari NL Affiliate Army"}
              </button>
              <p className="text-[11px] text-white/40">ID Staff mesti sama macam sistem diorang, kalau tak transfer akan gagal. Nama &amp; WhatsApp diambil automatik.</p>
              {affMsg && <div className={`text-xs ${affMsg.ok ? "text-emerald-300" : "text-rose-300"}`}>{affMsg.text}</div>}

              {affContacts.length > 0 && (
                <div className="max-h-52 space-y-1.5 overflow-y-auto pt-1">
                  {affContacts.map((c) => (
                    <div key={c.staff_id || c.name} className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/30 px-3 py-1.5">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12px] font-bold text-white">{c.name}</div>
                        <div className="truncate text-[10px] text-white/45">
                          <span style={{ color: "#a78bfa" }}>{c.staff_id}</span>{c.whatsapp ? ` · ${c.whatsapp}` : ""}
                        </div>
                      </div>
                      <button onClick={() => removeAffContact(c.staff_id || "")} disabled={savingAff} className="shrink-0 text-rose-400 hover:text-rose-300"><X className="h-3.5 w-3.5" /></button>
                    </div>
                  ))}
                </div>
              )}
              <button onClick={() => setShowModal(false)} className="w-full rounded-lg border border-white/10 bg-white/5 py-2 text-xs font-bold text-white/70 hover:bg-white/10">Selesai</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
