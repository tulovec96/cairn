/**
 * Integration test runner.
 *
 * Builds the app (unless --no-build), creates a brand-new SQLite database and storage directory,
 * starts the production server on its own port, runs the Vitest integration suite against it, and
 * shuts everything down. Nothing here touches the development database or data directory.
 *
 *   npm run test:integration            # build + test
 *   npm run test:integration -- --no-build
 *   npm run test:integration -- --serve   # start the isolated instance (with the integration admin) and keep it running for manual checks
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = process.env.ITEST_PORT || "3210";
const BASE = `http://localhost:${PORT}`;
const dataDir = path.join(root, ".data-itest");
const distDir = ".next-itest";
const useS3 = process.argv.includes("--s3");
const skipBuild = process.argv.includes("--no-build") && fs.existsSync(path.join(root, distDir, "BUILD_ID"));
const isWin = process.platform === "win32";
const npx = isWin ? "npx.cmd" : "npx";

const env = {
  ...process.env,
  DATABASE_URL: "file:../.data-itest/db/app.db?connection_limit=1&socket_timeout=60",
  DATA_DIR: "./.data-itest",
  APP_URL: BASE,
  APP_SECRET: "integration-test-secret-integration-test-secret-1234",
  NEXT_DIST_DIR: distDir,
  NODE_ENV: "production",
  PORT,
  ITEST_BASE_URL: BASE,
  // The test client sets X-Forwarded-For to simulate distinct networks, as a single trusted proxy would.
  TRUST_PROXY: "1",
  STRIPE_SECRET_KEY: "sk_test_integration_not_a_real_key",
  STRIPE_WEBHOOK_SECRET: "whsec_integration_test_secret",
  // --s3 runs the whole suite with blobs in an S3-compatible store (an authenticating in-memory mock, see tests/support).
  ...(useS3
    ? { STORAGE_PROVIDER: "s3", S3_ENDPOINT: "http://127.0.0.1:3220", S3_BUCKET: "cairn-itest", S3_ACCESS_KEY_ID: "AKIAIOSFODNN7EXAMPLE", S3_SECRET_ACCESS_KEY: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", S3_REGION: "us-east-1", S3_KEY_PREFIX: "itest" }
    : {}),
};

// Safety net: this script deletes its data directory and runs migrations, so it must never point at real data.
if (!env.DATABASE_URL.includes(".data-itest") || !env.DATA_DIR.includes(".data-itest")) {
  console.error("Refusing to run: the test environment is not isolated from the development database.");
  process.exit(2);
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: root, env, stdio: "inherit", shell: isWin, ...opts });
  if (r.status !== 0) {
    console.error(`\n> ${cmd} ${args.join(" ")} failed with exit code ${r.status}`);
    process.exit(r.status ?? 1);
  }
}

fs.rmSync(dataDir, { recursive: true, force: true });
fs.mkdirSync(path.join(dataDir, "db"), { recursive: true });

console.log("> Applying migrations to a fresh test database");
run(npx, ["prisma", "migrate", "deploy"]);

if (!skipBuild) {
  console.log("> Building the application");
  run(npx, ["next", "build"], { env: { ...env, NODE_ENV: "production" } });
}

let mockS3 = null;
if (useS3) {
  console.log("> Starting the mock S3 store on :3220");
  mockS3 = spawn(npx, ["tsx", "tests/support/mock-s3-cli.ts", "3220", "cairn-itest"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"], shell: isWin });
  mockS3.stderr.on("data", (d) => process.stderr.write(`[mock-s3] ${d}`));
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("mock S3 did not start")), 30_000);
    mockS3.stdout.on("data", (d) => { if (String(d).includes("listening")) { clearTimeout(t); resolve(); } });
  });
}

console.log(`> Starting server on ${BASE}`);
const server = spawn(process.execPath, ["server.mjs"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
let serverLog = "";
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));

function killServer() {
  for (const child of [server, mockS3]) {
    if (!child?.pid) continue;
    if (isWin) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else child.kill("SIGTERM");
  }
}
process.on("exit", killServer);
process.on("SIGINT", () => process.exit(130));

async function waitForHealth() {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/v1/health`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  console.error("Server did not become healthy.\n" + serverLog);
  process.exit(1);
}

await waitForHealth();
if (process.argv.includes("--serve")) {
  // Same isolated instance the tests use, seeded with the integration-test administrator (credentials as in tests/global-setup.ts).
  const creds = { email: "admin@itest.test", password: "admin passphrase for integration tests" };
  const headers = { "content-type": "application/json", origin: BASE, "x-forwarded-for": "10.0.0.1" };
  const login = await fetch(`${BASE}/api/v1/auth/login`, { method: "POST", headers, body: JSON.stringify(creds) });
  if (login.status !== 200) await fetch(`${BASE}/api/v1/auth/register`, { method: "POST", headers, body: JSON.stringify({ ...creds, displayName: "Admin" }) });
  console.log(`> Serving the isolated instance at ${BASE}. Press Ctrl+C to stop.`);
  await new Promise(() => {});
}
console.log("> Server is up. Running tests\n");
const args = ["vitest", "run", "tests/integration", ...process.argv.slice(2).filter((a) => a !== "--no-build" && a !== "--s3")];
const result = spawnSync(npx, args, { cwd: root, env: { ...env, NODE_ENV: "test" }, stdio: "inherit", shell: isWin });
killServer();
if (result.status !== 0) {
  console.error("\n--- server log (tail) ---\n" + serverLog.split("\n").slice(-40).join("\n"));
}
process.exit(result.status ?? 1);
