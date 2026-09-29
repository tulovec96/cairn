import { z } from "zod";
import { db } from "../db";
import { hashToken } from "../crypto";
import { Errors } from "../errors";
import { newId, randomString } from "../ids";
import { API_KEY_PREFIX } from "./actor";
import { audit } from "./audit";
import { assertFeature, assertLimit, entitlementsForUser } from "./entitlements";
import { SCOPES, type ApiKeyDto } from "@/lib/types";

export const createKeySchema = z.object({
  name: z.string().trim().min(1, "Give the key a name.").max(60),
  scopes: z.array(z.enum(SCOPES)).min(1, "Select at least one permission."),
  expiresInDays: z.number().int().min(1).max(3650).nullable().optional(),
});

function toDto(k: { id: string; name: string; prefix: string; scopes: string; createdAt: Date; lastUsedAt: Date | null; expiresAt: Date | null; revokedAt: Date | null }): ApiKeyDto {
  return {
    id: k.id,
    name: k.name,
    prefix: k.prefix,
    scopes: k.scopes.split(",").filter(Boolean),
    createdAt: k.createdAt.toISOString(),
    lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
    expiresAt: k.expiresAt?.toISOString() ?? null,
    revokedAt: k.revokedAt?.toISOString() ?? null,
  };
}

export async function listApiKeys(userId: string): Promise<ApiKeyDto[]> {
  const keys = await db.apiKey.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
  return keys.map(toDto);
}

/** Returns the plaintext key exactly once; only its SHA-256 hash is stored. The plan decides whether keys exist and how many. */
export async function createApiKey(userId: string, input: z.infer<typeof createKeySchema>, ip?: string): Promise<{ key: string; item: ApiKeyDto }> {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const ent = await entitlementsForUser(user);
  await assertFeature(ent, "api");
  assertLimit(ent, "apiKeys", await db.apiKey.count({ where: { userId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } }));
  const key = `${API_KEY_PREFIX}${randomString(43)}`;
  const row = await db.apiKey.create({
    data: {
      id: newId("key"),
      userId,
      name: input.name,
      prefix: key.slice(0, 12),
      keyHash: hashToken(key),
      scopes: [...new Set(input.scopes)].join(","),
      expiresAt: input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86400_000) : null,
    },
  });
  await audit({ actorType: "user", actorId: userId, action: "apikey.created", targetType: "api_key", targetId: row.id, ip, metadata: { name: row.name, scopes: row.scopes } });
  return { key, item: toDto(row) };
}

export async function revokeApiKey(userId: string, id: string, ip?: string) {
  const key = await db.apiKey.findFirst({ where: { id, userId } });
  if (!key) throw Errors.notFound("That API key doesn't exist.");
  if (!key.revokedAt) await db.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
  await audit({ actorType: "user", actorId: userId, action: "apikey.revoked", targetType: "api_key", targetId: id, ip, metadata: { name: key.name } });
}

/** Request counts per key, endpoint and day, from what the API wrapper recorded. Endpoints are route patterns, never ids. */
export async function apiUsageSummary(userId: string, days = 14) {
  const since = new Date(Date.now() - days * 86400_000);
  const rows = await db.apiUsage.findMany({ where: { userId, createdAt: { gte: since } }, select: { apiKeyId: true, endpoint: true, method: true, status: true, latencyMs: true, createdAt: true }, orderBy: { createdAt: "asc" }, take: 50_000 });
  const perDay = new Map<string, { requests: number; errors: number }>();
  const perEndpoint = new Map<string, { requests: number; totalLatency: number }>();
  const perKey = new Map<string, number>();
  for (const r of rows) {
    const day = r.createdAt.toISOString().slice(0, 10);
    const d = perDay.get(day) ?? { requests: 0, errors: 0 };
    d.requests++;
    if (r.status >= 400) d.errors++;
    perDay.set(day, d);
    const ek = `${r.method} ${r.endpoint}`;
    const e = perEndpoint.get(ek) ?? { requests: 0, totalLatency: 0 };
    e.requests++;
    e.totalLatency += r.latencyMs;
    perEndpoint.set(ek, e);
    if (r.apiKeyId) perKey.set(r.apiKeyId, (perKey.get(r.apiKeyId) ?? 0) + 1);
  }
  const keys = await db.apiKey.findMany({ where: { id: { in: [...perKey.keys()] } }, select: { id: true, name: true, prefix: true } });
  return {
    total: rows.length,
    errors: rows.filter((r) => r.status >= 400).length,
    daily: [...perDay.entries()].map(([day, v]) => ({ day, ...v })),
    endpoints: [...perEndpoint.entries()].sort((a, b) => b[1].requests - a[1].requests).slice(0, 15).map(([endpoint, v]) => ({ endpoint, requests: v.requests, avgLatencyMs: Math.round(v.totalLatency / v.requests) })),
    keys: keys.map((k) => ({ id: k.id, name: k.name, prefix: k.prefix, requests: perKey.get(k.id) ?? 0 })),
  };
}
