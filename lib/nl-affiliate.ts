// NL Affiliate Army — video ingest client.
//
// When an Editor video is transferred to an affiliate, we also POST it to the
// affiliate's own platform so it lands in their "Pending Post". Their endpoint
// takes our native shape (no translation), and is idempotent on source_id — so
// retries can never create duplicates.
//
// Credentials live in env ONLY (never in the repo):
//   NL_AFFILIATE_INGEST_URL    optional, defaults to prod
//   NL_AFFILIATE_INGEST_TOKEN  required — bearer key; missing = push disabled
//
// Per their spec: retry 5xx/network with the same source_id; never retry
// 400/401/404 (bad payload / bad key / unknown affiliate — retrying won't fix).

const INGEST_URL =
  process.env.NL_AFFILIATE_INGEST_URL || "https://www.nlaffliatearmy.com/api/posts/ingest";
const INGEST_TOKEN = process.env.NL_AFFILIATE_INGEST_TOKEN || "";

export const nlAffiliateConfigured = () => !!INGEST_TOKEN;

export type NlIngestResult = {
  ok: boolean;
  id?: number | string;
  duplicate?: boolean;
  error?: string;
  status?: number;
};

export type NlIngestInput = {
  // Identity is now a Staff ID (AFL-###) or the NL internal affiliate id —
  // email was retired 2026-07-23. Prefer affiliateId when present (immune to
  // typos); staffId is the fallback for manually-typed entries.
  affiliateId?: number | string | null;
  staffId?: string | null;
  outputUrl: string;
  caption?: string | null;
  coverTitle?: string | null;
  coverSubtitle?: string | null;
  coverThumbnailUrl?: string | null;
  /** YYYY-MM-DD. Omit to let them default to today (KL). */
  date?: string | null;
  /** Stable id — makes retries idempotent. Always send it. */
  sourceId: string;
};

export type NlAffiliate = {
  id: number | string;
  name: string;
  staffId: string;
  phone: string;
};

/** Today in Asia/Kuala_Lumpur as YYYY-MM-DD (their platform is KL-based). */
export function klToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export async function pushToNlAffiliate(
  input: NlIngestInput,
  opts: { retries?: number; timeoutMs?: number } = {}
): Promise<NlIngestResult> {
  if (!INGEST_TOKEN) return { ok: false, error: "NL_AFFILIATE_INGEST_TOKEN tak diset" };
  const affiliateId = input.affiliateId != null && String(input.affiliateId).trim() ? input.affiliateId : null;
  const staffId = String(input.staffId || "").trim();
  if (affiliateId == null && !staffId) return { ok: false, error: "ID Staff / affiliate_id kosong" };
  if (!input.outputUrl) return { ok: false, error: "video link tiada" };

  const metadata: Record<string, string> = {};
  if (input.coverTitle) metadata.cover_title = input.coverTitle;
  if (input.coverSubtitle) metadata.cover_subtitle = input.coverSubtitle;
  if (input.coverThumbnailUrl) metadata.cover_thumbnail_url = input.coverThumbnailUrl;

  const body = {
    // affiliate_id preferred (typo-proof); staff_id when we only have that.
    ...(affiliateId != null ? { affiliate_id: affiliateId } : { staff_id: staffId }),
    output_url: input.outputUrl,
    ...(input.caption ? { caption: input.caption } : {}),
    ...(Object.keys(metadata).length ? { metadata } : {}),
    date: input.date || klToday(),
    source_id: input.sourceId,
  };

  const retries = opts.retries ?? 2; // 3 attempts total
  const timeoutMs = opts.timeoutMs ?? 20_000;
  let last: NlIngestResult = { ok: false, error: "tidak dicuba" };

  for (let attempt = 0; attempt <= retries; attempt++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(INGEST_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${INGEST_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      const text = await res.text();
      let json: any = null;
      try { json = JSON.parse(text); } catch { /* non-JSON body */ }

      if (res.ok && json?.ok) {
        return { ok: true, id: json.id, duplicate: !!json.duplicate, status: res.status };
      }
      // 400 / 401 / 404 are terminal — retrying sends the identical payload.
      if (res.status >= 400 && res.status < 500) {
        return {
          ok: false,
          status: res.status,
          error: json?.error || text?.slice(0, 200) || `HTTP ${res.status}`,
        };
      }
      last = { ok: false, status: res.status, error: json?.error || `HTTP ${res.status}` };
    } catch (e: any) {
      last = { ok: false, error: e?.name === "AbortError" ? "timeout" : e?.message || "network error" };
    } finally {
      clearTimeout(t);
    }
    // 5xx / network → back off and retry with the SAME source_id.
    if (attempt < retries) await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
  }
  return last;
}

/** GET the ingest URL with the key → the roster (id, name, staff_id, phone). */
export async function fetchNlAffiliateRoster(): Promise<
  { ok: true; affiliates: NlAffiliate[] } | { ok: false; error: string }
> {
  if (!INGEST_TOKEN) return { ok: false, error: "NL_AFFILIATE_INGEST_TOKEN tak diset" };
  try {
    const res = await fetch(INGEST_URL, {
      headers: { Authorization: `Bearer ${INGEST_TOKEN}` },
      cache: "no-store",
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, error: json?.error || `HTTP ${res.status}` };
    const list = Array.isArray(json?.affiliates) ? json.affiliates : Array.isArray(json) ? json : [];
    return {
      ok: true,
      affiliates: list
        .map((a: any) => ({ id: a?.id, name: String(a?.name || ""), staffId: String(a?.staff_id || "").trim(), phone: String(a?.phone || "").trim() }))
        // Only affiliates with a Staff ID are transferable (some roster rows,
        // e.g. "Inhouse", have staff_id:null).
        .filter((a: NlAffiliate) => !!a.staffId),
    };
  } catch (e: any) {
    return { ok: false, error: e?.message || "network error" };
  }
}

/** GET ?staff_id=AFL-### → the single affiliate's {id, name, staff_id, phone}.
 *  Lets PeningLab take ONLY a Staff ID and get the name + WhatsApp back. */
export async function lookupNlAffiliate(
  staffId: string
): Promise<{ ok: true; affiliate: NlAffiliate } | { ok: false; error: string; status?: number }> {
  if (!INGEST_TOKEN) return { ok: false, error: "NL_AFFILIATE_INGEST_TOKEN tak diset" };
  const id = String(staffId || "").trim();
  if (!id) return { ok: false, error: "ID Staff kosong" };
  try {
    const res = await fetch(`${INGEST_URL}?staff_id=${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${INGEST_TOKEN}` },
      cache: "no-store",
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok || !json?.affiliate) {
      return { ok: false, status: res.status, error: json?.error || `HTTP ${res.status}` };
    }
    const a = json.affiliate;
    return {
      ok: true,
      affiliate: { id: a.id, name: String(a.name || ""), staffId: String(a.staff_id || id).trim(), phone: String(a.phone || "").trim() },
    };
  } catch (e: any) {
    return { ok: false, error: e?.message || "network error" };
  }
}
