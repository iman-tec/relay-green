import type { Metadata, Viewport } from "next";
import { Source_Serif_4, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { JsonLd } from "./_marketing/JsonLd";
import { AnalyticsGate } from "./_marketing/AnalyticsGate";
import { CookieConsent } from "./_marketing/CookieConsent";
import { RouteProgress } from "./_components/RouteProgress";
import { AosProvider } from "./_components/AosProvider";
import { organizationSchema, websiteSchema } from "../lib/seo/schema";

/*
 * Typography stack mirrors anthropic.com's manner: a calm transitional
 * serif for display + body, a neutral grotesque sans for eyebrows + UI,
 * and JetBrains Mono for code/labels. Anthropic ships proprietary
 * "Anthropic Serif / Sans / Mono" custom faces; we use the closest free
 * Google equivalents (Source Serif 4, Inter, JetBrains Mono) so the
 * editorial feel is the same without a paid licence. Fraunces and
 * Instrument Sans (the previous "more dramatized" pair) have been
 * retired sitewide. */
const sourceSerif = Source_Serif_4({
  variable: "--font-source-serif",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  style: ["normal", "italic"],
  display: "swap",
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  display: "swap",
});

/*
 * Canonical site URL. Used by Next.js to resolve relative URLs in metadata
 * (Open Graph images, alternates, etc.) and by `alternates.canonical` per
 * page below to set <link rel="canonical">. Vercel auto-redirects the
 * apex (relay.green → www.relay.green) and any preview deployments back to
 * this canonical so AI crawlers and Google index a single domain.
 */
const SITE_URL = "https://www.relay.green";

const DEFAULT_TITLE = "Relay.green, Human engineers, in seconds";
const DEFAULT_DESCRIPTION =
  "You're building with AI. We're the humans who help you ship. Click the green dot to get a qualified engineer in seconds.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: DEFAULT_TITLE,
    template: "%s · Relay",
  },
  description: DEFAULT_DESCRIPTION,
  applicationName: "Relay",
  authors: [{ name: "Relay", url: SITE_URL }],
  creator: "Relay",
  publisher: "Relay",
  keywords: [
    "AI build engineer",
    "human engineer for AI",
    "AI pair programming",
    "Cursor help",
    "Claude code help",
    "Lovable engineer",
    "Replit engineer",
    "vibe coding support",
    "AI build governance",
    "GDPR-compliant AI assistant",
    "SOC 2 AI",
  ],
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: "Relay",
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    locale: "en_US",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "Relay, human engineers, in seconds",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    images: ["/twitter-image"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  manifest: "/manifest.webmanifest",
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  category: "technology",
};

export const viewport: Viewport = {
  // Single dark theme — matches the dark-only tokens in globals.css.
  themeColor: "#2c2a26",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${sourceSerif.variable} ${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col" suppressHydrationWarning>
        <JsonLd data={[organizationSchema(), websiteSchema()]} />
        <RouteProgress />
        <AosProvider />
        {children}
        <CookieConsent />
        <AnalyticsGate />
      </body>
    </html>
  );
}
