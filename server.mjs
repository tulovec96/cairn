/**
 * Production entry point (`npm start`).
 *
 * Next.js route handlers can't see the TCP peer address, and without it any client could claim an
 * arbitrary IP via `X-Forwarded-For` and sidestep IP-based rate limits. This thin wrapper stamps every
 * request with the real peer address (discarding any client-supplied value) so the app can rely on it.
 *
 * Behind a reverse proxy, set TRUST_PROXY=<number of proxies> instead and make the proxy append to
 * X-Forwarded-For; the app then uses that header.
 */
import { createServer } from "node:http";
import next from "next";
import nextEnv from "@next/env";

const dev = process.env.NODE_ENV !== "production" && process.argv.includes("--dev");
nextEnv.loadEnvConfig(process.cwd(), dev);

process.env.CAIRN_CUSTOM_SERVER = "1";
const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const hostname = process.env.HOSTNAME && process.env.HOSTNAME !== "localhost" ? process.env.HOSTNAME : "0.0.0.0";

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();
await app.prepare();

const server = createServer((req, res) => {
  delete req.headers["x-cairn-peer"];
  req.headers["x-cairn-peer"] = req.socket.remoteAddress ?? "unknown";
  handle(req, res).catch((err) => {
    console.error("[server] unhandled error", err);
    if (!res.headersSent) res.statusCode = 500;
    res.end();
  });
});
// Chunk uploads are short requests, but slow links should not be cut off mid-chunk.
server.requestTimeout = 15 * 60_000;
server.headersTimeout = 60_000;
server.keepAliveTimeout = 65_000;

server.listen(port, hostname, () => {
  console.log(`> Cairn ready on http://${hostname === "0.0.0.0" ? "localhost" : hostname}:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
