import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, DM_Sans, JetBrains_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";

// Self-host fonts via next/font — eliminates blocking @import to fonts.googleapis.com
// (was costing 200-600ms LCP). Subsets + weights match what we actually use across
// the app (display headings, body copy, mono badges/countdown).
const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["500", "700", "800"],
  display: "swap",
  variable: "--peninglab-font-display",
});
const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--peninglab-font-body",
});
const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["500", "700"],
  display: "swap",
  variable: "--peninglab-font-mono",
});

export const metadata: Metadata = {
  title: "Peninglab.com : Ultimate Hack Content",
  description:
    "Hasilkan 10 video UGC TikTok Shop dalam 3 minit. AI Creative Director susun framework, dialog, hook & CTA. Tak perlu creator, tak perlu shoot.",
  metadataBase: new URL("https://peninglab.com"),
  openGraph: {
    title: "Peninglab.com : Ultimate Hack Content",
    description:
      "Hasilkan 10 video UGC TikTok Shop dalam 3 minit dengan AI.",
    type: "website",
    locale: "ms_MY",
    siteName: "PeningLab",
    images: [
      {
        url: "/og-cover.png",
        width: 1200,
        height: 630,
        alt: "PeningLab — AI UGC for TikTok Shop",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Peninglab.com : Ultimate Hack Content",
    description:
      "Hasilkan 10 video UGC TikTok Shop dalam 3 minit dengan AI.",
    images: ["/og-cover.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
  width: "device-width",
  initialScale: 1,
};

// Conversion tracking — fed from env so values aren't baked into git history.
// Set NEXT_PUBLIC_META_PIXEL_ID + NEXT_PUBLIC_GA_ID + NEXT_PUBLIC_TIKTOK_PIXEL_ID
// in Vercel env. Without them the scripts simply don't render.
const META_PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID;
const GA_ID = process.env.NEXT_PUBLIC_GA_ID;
const TIKTOK_PIXEL_ID = process.env.NEXT_PUBLIC_TIKTOK_PIXEL_ID;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ms"
      className={`h-full ${bricolage.variable} ${dmSans.variable} ${jetbrains.variable}`}
    >
      <head>
        {/* Preconnect to Supabase storage — every demo video + hero image lives there.
            Saves ~150ms on the first asset request by warming DNS+TLS in parallel. */}
        <link
          rel="preconnect"
          href="https://zoxgcqlqovkvlrmpcikt.supabase.co"
          crossOrigin="anonymous"
        />
        <link rel="dns-prefetch" href="https://zoxgcqlqovkvlrmpcikt.supabase.co" />
      </head>
      <body className="min-h-full flex flex-col">
        {children}

        {/* ── Meta Pixel ───────────────────────────────────────────────────
            afterInteractive = loads after page is interactive, doesn't block LCP.
            Without this the user's Meta ads can't track Purchase / track audiences. */}
        {META_PIXEL_ID && (
          <Script id="meta-pixel" strategy="afterInteractive">
            {`
              !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
              n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
              n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
              t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
              document,'script','https://connect.facebook.net/en_US/fbevents.js');
              fbq('init', '${META_PIXEL_ID}');
              fbq('track', 'PageView');
            `}
          </Script>
        )}

        {/* ── Google Analytics 4 ────────────────────────────────────────── */}
        {GA_ID && (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
              strategy="afterInteractive"
            />
            <Script id="ga4" strategy="afterInteractive">
              {`
                window.dataLayer = window.dataLayer || [];
                function gtag(){dataLayer.push(arguments);}
                gtag('js', new Date());
                gtag('config', '${GA_ID}', { send_page_view: true });
              `}
            </Script>
          </>
        )}

        {/* ── TikTok Pixel (relevant for TikTok Shop sellers) ───────────── */}
        {TIKTOK_PIXEL_ID && (
          <Script id="tiktok-pixel" strategy="afterInteractive">
            {`
              !function (w, d, t) {
                w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie","holdConsent","revokeConsent","grantConsent"],ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e};ttq.load=function(e,n){var r="https://analytics.tiktok.com/i18n/pixel/events.js",o=n&&n.partner;ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=r,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};n=document.createElement("script");n.type="text/javascript",n.async=!0,n.src=r+"?sdkid="+e+"&lib="+t;e=document.getElementsByTagName("script")[0];e.parentNode.insertBefore(n,e)};
                ttq.load('${TIKTOK_PIXEL_ID}');
                ttq.page();
              }(window, document, 'ttq');
            `}
          </Script>
        )}
      </body>
    </html>
  );
}
