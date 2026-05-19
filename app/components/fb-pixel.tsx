"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

// Facebook Pixel browser snippet — loads ONLY on the public marketing
// front-end (landing page + pricing + checkout + auth). Skipped on
// /dashboard and /admin because those routes are for already-logged-in
// users + admins, not the ad-traffic funnel.
//
// Per user direction: 'only at peninglab.com front end..because ads
// will redirect at it'.
//
// PageView fires automatically when the Pixel installs. Custom events
// (Purchase / Lead / etc.) can be fired from any client component via:
//     window.fbq?.('track', 'Purchase', { value: 49, currency: 'MYR' }, { eventID: 'order-123' });
// Pass the SAME eventID to lib/fb-capi.ts sendCapiEvent server-side
// so Meta dedupes the browser + server events.

declare global {
  interface Window {
    fbq?: any;
    _fbq?: any;
  }
}

// Routes where the Pixel should NOT load. Everything else (root /,
// /pricing, /checkout, /auth/*, etc.) gets the Pixel.
const PIXEL_SKIP_PREFIXES = ["/dashboard", "/admin"];

export default function FBPixel() {
  const pathname = usePathname();

  useEffect(() => {
    let cancelled = false;
    let installed = false;

    // Skip dashboard + admin routes — Pixel is for marketing/landing
    // only, where ad traffic lands. Logged-in app routes don't need
    // to fire PageView to Facebook (would inflate noise + cost).
    if (PIXEL_SKIP_PREFIXES.some((p) => pathname?.startsWith(p))) {
      return;
    }

    // ──────────── Internal visit beacon (PAID-ADS ONLY) ────────────
    // Fires ONCE per browser session (sessionStorage guard) and ONLY
    // when the landing URL has a utm_source param — i.e. the visitor
    // arrived from a Meta ad link. Organic visitors are skipped so the
    // /admin/ads dashboard shows pure paid-traffic attribution without
    // noise from existing clients hitting the marketing page.
    function fireVisitBeacon() {
      try {
        const params = new URLSearchParams(window.location.search);
        const utmSource = params.get("utm_source");
        // GATE: no utm_source → organic visitor → don't record.
        if (!utmSource) return;

        const utm = {
          source: utmSource,
          medium: params.get("utm_medium") || undefined,
          campaign: params.get("utm_campaign") || undefined,
          content: params.get("utm_content") || undefined,
          term: params.get("utm_term") || undefined,
        };

        // Persist UTM in a 30-day cookie so the checkout form can later
        // attach it to the payment row even if the user clicks Bayar a
        // couple of days after landing. Cookie outlives sessionStorage
        // because purchase attribution needs to survive tab closes.
        try {
          const maxAge = 60 * 60 * 24 * 30; // 30 days
          const json = encodeURIComponent(JSON.stringify(utm));
          document.cookie = `peninglab_utm=${json}; Max-Age=${maxAge}; Path=/; SameSite=Lax`;
        } catch {
          // Cookie write failure (e.g. blocked cookies) — beacon still
          // fires, but downstream payment won't be UTM-attributed.
        }

        const SESSION_KEY = "peninglab-visit-fired";
        if (typeof sessionStorage === "undefined") return;
        if (sessionStorage.getItem(SESSION_KEY)) return; // already counted this session
        sessionStorage.setItem(SESSION_KEY, "1");

        // Stable per-tab id so the same session counts as ONE visitor
        // even if they navigate around. Lives only in sessionStorage so
        // a new tab = a new visitor.
        let sid = sessionStorage.getItem("peninglab-sid");
        if (!sid) {
          sid = Math.random().toString(36).slice(2) + Date.now().toString(36);
          sessionStorage.setItem("peninglab-sid", sid);
        }

        // Fire-and-forget. Use keepalive so the request survives if the
        // user closes the tab milliseconds after landing (common on ads).
        fetch("/api/analytics/visit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            path: window.location.pathname,
            session_id: sid,
            utm,
          }),
          keepalive: true,
        }).catch(() => {});
      } catch {
        // Beacon must never throw — admin dashboard accuracy is
        // non-critical relative to the user-facing page experience.
      }
    }

    async function init() {
      try {
        // Fire visit beacon independently of Pixel — even if Pixel
        // config call fails / Pixel is disabled, we still want the
        // admin dashboard to count visitors.
        fireVisitBeacon();

        const r = await fetch("/api/fb-pixel/config", { cache: "no-store" });
        const d = await r.json();
        if (cancelled) return;
        if (!d?.enabled || !d?.pixel_id) return;
        if (installed) return;
        installed = true;

        // Standard Meta Pixel init snippet — straight from Facebook's
        // installation guide, lightly cleaned. Initializes window.fbq
        // and fires the first PageView. Subsequent client-side calls
        // (e.g. on plan upgrade) just call window.fbq('track', ...).
        (function (f: any, b: Document, e: string, v: string) {
          if (f.fbq) return;
          const n: any = (f.fbq = function () {
            // eslint-disable-next-line prefer-rest-params
            n.callMethod ? n.callMethod.apply(n, arguments as any) : n.queue.push(arguments);
          });
          if (!f._fbq) f._fbq = n;
          n.push = n;
          n.loaded = true;
          n.version = "2.0";
          n.queue = [];
          const t = b.createElement(e) as HTMLScriptElement;
          t.async = true;
          t.src = v;
          const s = b.getElementsByTagName(e)[0];
          s.parentNode?.insertBefore(t, s);
        })(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");

        window.fbq("init", d.pixel_id);
        window.fbq("track", "PageView");
      } catch {
        // Silently skip on network / parse errors — Pixel is non-critical.
      }
    }
    void init();
    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
