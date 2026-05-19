import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, DM_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import FBPixel from "./components/fb-pixel";

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
        {/* Preconnect to Supabase storage — every demo video + hero image lives
            there. Saves ~150ms on the first asset request by warming DNS+TLS in
            parallel with HTML parsing. */}
        <link
          rel="preconnect"
          href="https://zoxgcqlqovkvlrmpcikt.supabase.co"
          crossOrigin="anonymous"
        />
        <link rel="dns-prefetch" href="https://zoxgcqlqovkvlrmpcikt.supabase.co" />
      </head>
      <body className="min-h-full flex flex-col">
        <FBPixel />
        {children}
      </body>
    </html>
  );
}
