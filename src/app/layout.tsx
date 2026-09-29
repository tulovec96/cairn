import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { getPageActor, getThemePreference } from "@/server/page-auth";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Cairn — file hosting", template: "%s · Cairn" },
  description: "Upload files, get a link. Resumable uploads, expiring and password-protected links, and a full file manager.",
  applicationName: "Cairn",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f6f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0b101c" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [theme, actor] = await Promise.all([getThemePreference(), getPageActor()]);
  return (
    <html lang="en" data-theme={theme} data-tz={actor?.user.timezone || undefined} className={`${geistSans.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <body className="min-h-dvh antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[200] focus:rounded-md focus:bg-accent focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-accent-fg"
        >
          Skip to content
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
