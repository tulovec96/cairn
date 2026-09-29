import { db } from "@/server/db";
import { json } from "@/server/http";
import { storage } from "@/server/storage";

export const dynamic = "force-dynamic";

export async function GET() {
  let database = false;
  try {
    await db.$queryRaw`SELECT 1`;
    database = true;
  } catch {
    database = false;
  }
  const store = await storage().health();
  const ok = database && store.ok;
  return json({ status: ok ? "ok" : "degraded", database, storage: store.ok }, { status: ok ? 200 : 503 });
}
