import { PrismaClient } from "@prisma/client";

const globalForDb = globalThis as unknown as { __cairnDb?: PrismaClient };

function create(): PrismaClient {
  const client = new PrismaClient({ log: process.env.PRISMA_LOG === "1" ? ["query", "warn", "error"] : ["error"] });
  // WAL keeps readers from blocking the writer (chunk bookkeeping vs. list queries).
  client.$queryRawUnsafe("PRAGMA journal_mode=WAL").catch(() => undefined);
  client.$queryRawUnsafe("PRAGMA synchronous=NORMAL").catch(() => undefined);
  client.$queryRawUnsafe("PRAGMA busy_timeout=30000").catch(() => undefined);
  return client;
}

export const db: PrismaClient = globalForDb.__cairnDb ?? (globalForDb.__cairnDb = create());

export type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
