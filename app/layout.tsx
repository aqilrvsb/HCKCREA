import type { Metadata } from "next";
import "./globals.css";

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
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ms" className="h-full">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
