import path from "node:path";
import type { NextConfig } from "next";

const secure = (process.env.APP_URL ?? "").startsWith("https://");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Lets a second instance (e.g. the integration-test server) build into its own directory.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  reactStrictMode: true,
  // Native / streaming dependencies stay outside the bundle.
  serverExternalPackages: ["sharp", "archiver", "busboy", "@prisma/client"],
  turbopack: { root: path.resolve(__dirname) },
  async headers() {
    return [
      {
        // File delivery (/dl) sets its own framing/embedding headers per response (embeds are opt-in per share).
        source: "/((?!dl/).*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          ...(secure ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
        ],
      },
    ];
  },
};

export default nextConfig;
