import path from "node:path";

const isProd = process.env.NODE_ENV === "production";

function resolveDir(value: string | undefined, fallback: string): string {
  return path.resolve(/*turbopackIgnore: true*/ process.cwd(), value && value.length > 0 ? value : fallback);
}

const appUrl = (process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");

function loadSecret(): string {
  const secret = process.env.APP_SECRET;
  if (secret && secret.length >= 32) return secret;
  if (isProd && process.env.NEXT_PHASE !== "phase-production-build") {
    throw new Error("APP_SECRET must be set to a random value of at least 32 characters in production.");
  }
  return "development-only-secret-do-not-use-in-production-0123456789";
}

export const env = {
  isProd,
  appUrl,
  secureCookies: appUrl.startsWith("https://"),
  dataDir: resolveDir(process.env.DATA_DIR, "./data"),
  get storageDir() {
    return path.join(this.dataDir, "storage");
  },
  get tmpDir() {
    return path.join(this.dataDir, "tmp");
  },
  get secret() {
    return loadSecret();
  },
  workerEnabled: process.env.DISABLE_WORKER !== "1",
};
