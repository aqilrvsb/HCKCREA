// Facebook Conversions API (CAPI) helper.
//
// Sends server-side events to Meta's Events Manager so Facebook can
// match conversions back to ad impressions even when the browser pixel
// is blocked (iOS Safari ITP, ad-blockers, network failures). The
// browser pixel + CAPI work TOGETHER — Meta dedupes events that share
// the same event_id, so we can fire both and Meta picks one.
//
// Setup is admin-driven via /admin/settings → Facebook Conversions API
// section. Required: Pixel ID + Access Token. Optional: Test Event
// Code (for verifying events in Events Manager > Test Events tab).
//
// Standard events we support:
//   - Purchase          → subscription / top-up payment success
//   - Lead              → user signed up (free account)
//   - CompleteRegistration → user activated paid plan
//   - Subscribe         → recurring subscription confirmed
//   - InitiateCheckout  → user opened the upgrade modal
//   - ViewContent       → user opened a paid-only feature
//
// Meta requires PII (email, phone) to be hashed with SHA-256 before
// sending. user_data fields are auto-hashed by hashUserData() below.

import { createHash } from "crypto";
import { getSetting } from "@/lib/settings";

const GRAPH_API_VERSION = "v19.0";
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

export type FBCapiConfig = {
  pixel_id?: string;
  access_token?: string;
  test_event_code?: string;
  enabled?: boolean;
};

export type FBStandardEvent =
  | "Purchase"
  | "Lead"
  | "CompleteRegistration"
  | "Subscribe"
  | "StartTrial"
  | "InitiateCheckout"
  | "AddToCart"
  | "ViewContent"
  | "PageView"
  | "Search";

export type FBUserData = {
  /** Hashed automatically — pass raw email. */
  email?: string | null;
  /** Hashed automatically — pass raw phone in E.164 (e.g. +60123456789). */
  phone?: string | null;
  /** External user ID — your DB user id. Hashed automatically. */
  external_id?: string | null;
  /** Client IP from request headers (NOT hashed). */
  client_ip_address?: string | null;
  /** Browser user agent (NOT hashed). */
  client_user_agent?: string | null;
  /** Facebook click ID (_fbc cookie value). */
  fbc?: string | null;
  /** Facebook browser ID (_fbp cookie value). */
  fbp?: string | null;
};

export type FBCustomData = {
  /** Monetary value of the event (e.g. 49.00 for a RM 49 purchase). */
  value?: number;
  /** ISO 4217 currency code (MYR / USD / etc.). */
  currency?: string;
  /** Optional content IDs (SKU / product code). */
  content_ids?: string[];
  /** Optional content name. */
  content_name?: string;
  /** Optional content category. */
  content_category?: string;
  /** Optional content type ('product' / 'product_group'). */
  content_type?: "product" | "product_group";
  /** Number of items in the order. */
  num_items?: number;
  /** Search string for Search events. */
  search_string?: string;
  /** Status for Subscribe events ('active' / 'trialing'). */
  status?: string;
};

function sha256Lower(s: string | null | undefined): string | undefined {
  if (!s) return undefined;
  const norm = String(s).trim().toLowerCase();
  if (!norm) return undefined;
  return createHash("sha256").update(norm).digest("hex");
}

function hashUserData(u: FBUserData): Record<string, any> {
  const out: Record<string, any> = {};
  // Hashed fields (Meta requires SHA-256 lowercase normalized values)
  const em = sha256Lower(u.email);
  const ph = sha256Lower(u.phone?.replace(/[^\d]/g, ""));
  const ext = sha256Lower(u.external_id);
  if (em) out.em = [em];
  if (ph) out.ph = [ph];
  if (ext) out.external_id = [ext];
  // Non-hashed fields
  if (u.client_ip_address) out.client_ip_address = u.client_ip_address;
  if (u.client_user_agent) out.client_user_agent = u.client_user_agent;
  if (u.fbc) out.fbc = u.fbc;
  if (u.fbp) out.fbp = u.fbp;
  return out;
}

/**
 * Read the admin-configured Facebook CAPI settings.
 * Returns null when unconfigured (caller should skip the event).
 */
export async function getFBCapiConfig(): Promise<FBCapiConfig | null> {
  const cfg = await getSetting<FBCapiConfig>("fb_capi");
  if (!cfg?.pixel_id || !cfg?.access_token || cfg?.enabled === false) {
    return null;
  }
  return cfg;
}

/**
 * Send a server-side event to Meta's Conversions API.
 *
 * Returns { ok: true } on success; { ok: false, error } on failure.
 * NEVER throws — call sites are typically fire-and-forget after a
 * payment/signup so a CAPI failure shouldn't break the user flow.
 *
 * @param eventName    Standard FB event name.
 * @param eventId      Idempotency key — pass the same id from the
 *                     browser Pixel call so Meta can dedupe. Typically
 *                     the DB row id (subscription_id, user_id, etc.).
 * @param userData     User identifiers (email + phone + external_id).
 *                     Hashed before sending per Meta's requirements.
 * @param customData   Event-specific data (value, currency, etc.).
 * @param eventSourceUrl URL of the page where the event happened.
 */
export async function sendCapiEvent(opts: {
  eventName: FBStandardEvent;
  eventId: string;
  userData: FBUserData;
  customData?: FBCustomData;
  eventSourceUrl?: string;
  /** Unix epoch seconds — defaults to now. */
  eventTime?: number;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const cfg = await getFBCapiConfig();
    if (!cfg) return { ok: false, error: "CAPI not configured" };

    const payload: any = {
      data: [
        {
          event_name: opts.eventName,
          event_time: opts.eventTime ?? Math.floor(Date.now() / 1000),
          event_id: opts.eventId,
          action_source: "website",
          ...(opts.eventSourceUrl ? { event_source_url: opts.eventSourceUrl } : {}),
          user_data: hashUserData(opts.userData),
          ...(opts.customData ? { custom_data: opts.customData } : {}),
        },
      ],
    };
    if (cfg.test_event_code) {
      payload.test_event_code = cfg.test_event_code;
    }

    const url = `${GRAPH_API_BASE}/${cfg.pixel_id}/events?access_token=${encodeURIComponent(
      cfg.access_token!
    )}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        error: json?.error?.message || `HTTP ${res.status}`,
      };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "CAPI request failed" };
  }
}

/** Convenience: fire a Purchase event. Pass the order id as eventId so
 *  it matches the browser fbq('track', 'Purchase', {...}, {eventID}). */
export async function sendPurchase(opts: {
  orderId: string;
  userData: FBUserData;
  value: number;
  currency?: string;
  contentName?: string;
  eventSourceUrl?: string;
}) {
  return sendCapiEvent({
    eventName: "Purchase",
    eventId: opts.orderId,
    userData: opts.userData,
    customData: {
      value: opts.value,
      currency: opts.currency || "MYR",
      ...(opts.contentName ? { content_name: opts.contentName } : {}),
    },
    eventSourceUrl: opts.eventSourceUrl,
  });
}

/** Convenience: fire a Lead event. eventId = user id (one Lead per user). */
export async function sendLead(opts: {
  userId: string;
  userData: FBUserData;
  eventSourceUrl?: string;
}) {
  return sendCapiEvent({
    eventName: "Lead",
    eventId: `lead-${opts.userId}`,
    userData: opts.userData,
    eventSourceUrl: opts.eventSourceUrl,
  });
}

/** Convenience: fire a Subscribe event for recurring plan confirmations. */
export async function sendSubscribe(opts: {
  subscriptionId: string;
  userData: FBUserData;
  value: number;
  currency?: string;
  status?: string; // 'active' / 'trialing'
  eventSourceUrl?: string;
}) {
  return sendCapiEvent({
    eventName: "Subscribe",
    eventId: opts.subscriptionId,
    userData: opts.userData,
    customData: {
      value: opts.value,
      currency: opts.currency || "MYR",
      ...(opts.status ? { status: opts.status } : {}),
    },
    eventSourceUrl: opts.eventSourceUrl,
  });
}
