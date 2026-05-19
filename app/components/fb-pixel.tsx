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

    async function init() {
      try {
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
