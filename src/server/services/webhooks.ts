import { z } from "zod";
import type { Webhook, WebhookDelivery } from "@prisma/client";
import { EVENT_TYPES, EVENTS, type EventType } from "@/config/events";
import { db } from "../db";
import { decryptSecret, encryptSecret, hmacHex } from "../crypto";
import { Errors } from "../errors";
import type { AppEvent } from "../events";
import { newId, newSecretToken } from "../ids";
import { enqueueJob } from "../jobs/queue";
import * as rate from "../ratelimit";
import { parseSafeUrl, safeFetch } from "../security/ssrf";
import { getSettings } from "../settings";
import { assertScope, workspaceIdOf, type Actor } from "./actor";
import { assertFlag } from "./flags";
import { assertFeature, assertLimit } from "./entitlements";
import { entitlementsForScope } from "./limits";
import { assertCan } from "./permissions";
import { parseJson } from "./serializers";
import { addUsage, getUsage, subjectOf } from "./usage";
import { isUnlimited } from "@/config/entitlements";

export interface WebhookDto {
  id: string;
  name: string;
  url: string;
  events: string[];
  enabled: boolean;
  failureCount: number;
  lastDeliveryAt: string | null;
  createdAt: string;
}

export interface DeliveryDto {
  id: string;
  webhookId: string;
  eventId: string;
  event: string;
  status: string;
  responseCode: number | null;
  latencyMs: number | null;
  attempts: number;
  error: string | null;
  createdAt: string;
  deliveredAt: string | null;
}

const toDto = (w: Webhook): WebhookDto => ({
  id: w.id,
  name: w.name,
  url: w.url,
  events: parseJson<string[]>(w.events, []),
  enabled: w.enabled,
  failureCount: w.failureCount,
  lastDeliveryAt: w.lastDeliveryAt?.toISOString() ?? null,
  createdAt: w.createdAt.toISOString(),
});

const deliveryDto = (d: WebhookDelivery): DeliveryDto => ({
  id: d.id,
  webhookId: d.webhookId,
  eventId: d.eventId,
  event: d.event,
  status: d.status,
  responseCode: d.responseCode,
  latencyMs: d.latencyMs,
  attempts: d.attempts,
  error: d.error,
  createdAt: d.createdAt.toISOString(),
  deliveredAt: d.deliveredAt?.toISOString() ?? null,
});

export const webhookSchema = z.object({
  name: z.string().trim().min(1, "Give the webhook a name.").max(80),
  url: z.string().trim().min(8).max(2000),
  events: z.array(z.union([z.literal("*"), z.enum(EVENT_TYPES as [EventType, ...EventType[]])])).min(1, "Choose at least one event."),
  enabled: z.boolean().optional(),
});

const orgFilter = (actor: Actor) => ({ ownerId: actor.user.id, orgId: actor.workspace.orgId });

async function gate(actor: Actor) {
  await assertFlag("webhooks");
  assertScope(actor, "webhooks:write");
}

export async function listWebhooks(actor: Actor): Promise<WebhookDto[]> {
  await assertFlag("webhooks");
  return (await db.webhook.findMany({ where: orgFilter(actor), orderBy: { createdAt: "desc" } })).map(toDto);
}

async function validateUrl(url: string) {
  const settings = await getSettings();
  return parseSafeUrl(url, { allowPrivate: settings.webhooks.allowPrivateNetworks });
}

/** Returns the signing secret exactly once. */
export async function createWebhook(actor: Actor, input: z.infer<typeof webhookSchema>): Promise<{ webhook: WebhookDto; secret: string }> {
  await gate(actor);
  assertCan(actor, "manage");
  const ent = await entitlementsForScope({ userId: actor.user.id, orgId: actor.workspace.orgId }, actor.user);
  await assertFeature(ent, "webhooks");
  assertLimit(ent, "webhooks", await db.webhook.count({ where: orgFilter(actor) }));
  const url = await validateUrl(input.url);
  const secret = `whsec_${newSecretToken(24)}`;
  const row = await db.webhook.create({
    data: { id: newId("wbh"), ownerId: actor.user.id, orgId: actor.workspace.orgId, name: input.name, url: url.toString(), secretEnc: encryptSecret(secret), events: JSON.stringify([...new Set(input.events)]), enabled: input.enabled ?? true },
  });
  return { webhook: toDto(row), secret };
}

async function ownedWebhook(actor: Actor, id: string) {
  const w = await db.webhook.findFirst({ where: { id, ...orgFilter(actor) } });
  if (!w) throw Errors.notFound("That webhook doesn't exist.");
  return w;
}

export async function updateWebhook(actor: Actor, id: string, patch: Partial<z.infer<typeof webhookSchema>>): Promise<WebhookDto> {
  await gate(actor);
  assertCan(actor, "manage");
  await ownedWebhook(actor, id);
  const url = patch.url ? (await validateUrl(patch.url)).toString() : undefined;
  const updated = await db.webhook.update({
    where: { id },
    data: {
      ...(patch.name ? { name: patch.name } : {}),
      ...(url ? { url } : {}),
      ...(patch.events ? { events: JSON.stringify([...new Set(patch.events)]) } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled, ...(patch.enabled ? { failureCount: 0 } : {}) } : {}),
    },
  });
  return toDto(updated);
}

export async function rotateWebhookSecret(actor: Actor, id: string): Promise<{ secret: string }> {
  await gate(actor);
  assertCan(actor, "manage");
  await ownedWebhook(actor, id);
  const secret = `whsec_${newSecretToken(24)}`;
  await db.webhook.update({ where: { id }, data: { secretEnc: encryptSecret(secret) } });
  return { secret };
}

export async function deleteWebhook(actor: Actor, id: string): Promise<void> {
  await gate(actor);
  assertCan(actor, "manage");
  await ownedWebhook(actor, id);
  await db.webhook.delete({ where: { id } });
}

export async function listDeliveries(actor: Actor, webhookId: string, opts: { cursor?: string; limit?: number } = {}) {
  await ownedWebhook(actor, webhookId);
  const limit = Math.min(100, opts.limit ?? 30);
  const rows = await db.webhookDelivery.findMany({ where: { webhookId }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: limit + 1, ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}) });
  const page = rows.slice(0, limit);
  return { items: page.map(deliveryDto), nextCursor: rows.length > limit ? page[page.length - 1].id : null };
}

export async function getDelivery(actor: Actor, webhookId: string, deliveryId: string) {
  await ownedWebhook(actor, webhookId);
  const d = await db.webhookDelivery.findFirst({ where: { id: deliveryId, webhookId } });
  if (!d) throw Errors.notFound("That delivery doesn't exist.");
  return { ...deliveryDto(d), payload: parseJson<unknown>(d.payload, d.payload), responseBody: d.responseBody };
}

// ---------------------------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------------------------

export interface WebhookPayload {
  id: string;
  type: string;
  createdAt: string;
  data: Record<string, unknown>;
}

function payloadFor(event: AppEvent, eventId: string): WebhookPayload {
  return {
    id: eventId,
    type: event.type,
    createdAt: new Date().toISOString(),
    data: {
      fileId: event.fileId ?? undefined,
      folderId: event.folderId ?? undefined,
      name: event.targetName || undefined,
      actor: event.actorLabel ?? undefined,
      ...(event.data ?? {}),
    },
  };
}

/** Called by the event bus: create pending deliveries for every subscribed, enabled webhook. */
export async function enqueueForEvent(event: AppEvent, eventId: string): Promise<void> {
  const hooks = await db.webhook.findMany({ where: { ownerId: event.ownerId, orgId: event.orgId ?? null, enabled: true } });
  const matching = hooks.filter((h) => {
    const list = parseJson<string[]>(h.events, []);
    return list.includes("*") || list.includes(event.type);
  });
  if (!matching.length) return;
  const settings = await getSettings();
  const scope = { userId: event.ownerId, orgId: event.orgId ?? null };
  const ent = await entitlementsForScope(scope);
  if (!ent.features.webhooks) return;
  const cap = ent.limits.webhookDeliveriesPerMonth;
  const payload = JSON.stringify(payloadFor(event, eventId));
  for (const h of matching) {
    if (!isUnlimited(cap) && (await getUsage(subjectOf(scope), "webhookDeliveries")) >= cap) return;
    const delivery = await db.webhookDelivery.create({ data: { id: newId("wdl"), webhookId: h.id, eventId, event: event.type, payload, status: "pending" } });
    await enqueueJob("deliver_webhook", { deliveryId: delivery.id }, { dedupeKey: `wh:${delivery.id}`, maxAttempts: settings.webhooks.maxAttempts, userId: event.ownerId });
  }
}

/** Signature scheme: `X-Cairn-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">`. Receivers should reject old timestamps. */
export function signPayload(secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)) {
  return { timestamp, header: `t=${timestamp},v1=${hmacHex(secret, `${timestamp}.${body}`)}` };
}

/** One delivery attempt. Throws on failure so the job queue retries with backoff. */
export async function attemptDelivery(deliveryId: string, opts: { final?: boolean } = {}): Promise<DeliveryDto> {
  const d = await db.webhookDelivery.findUnique({ where: { id: deliveryId }, include: { webhook: true } });
  if (!d) throw new Error("Delivery not found");
  const hook = d.webhook;
  const settings = await getSettings();
  const started = Date.now();
  let code: number | null = null;
  let body: string | null = null;
  let error: string | null = null;
  try {
    const secret = decryptSecret(hook.secretEnc);
    const { timestamp, header } = signPayload(secret, d.payload);
    const res = await safeFetch(hook.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "Cairn-Webhooks/1.0",
        "x-cairn-event": d.event,
        "x-cairn-delivery": d.id,
        "x-cairn-timestamp": String(timestamp),
        "x-cairn-signature": header,
      },
      body: d.payload,
      signal: AbortSignal.timeout(settings.webhooks.timeoutMs),
      allowPrivate: settings.webhooks.allowPrivateNetworks,
    });
    code = res.status;
    body = (await res.text().catch(() => "")).slice(0, 500);
    if (code < 200 || code >= 300) error = `The endpoint answered ${code}.`;
  } catch (err) {
    error = (err as Error).name === "TimeoutError" ? "The endpoint took too long to respond." : (err as Error).message.slice(0, 300);
  }
  const ok = !error;
  const latency = Date.now() - started;
  const updated = await db.webhookDelivery.update({
    where: { id: d.id },
    data: { attempts: { increment: 1 }, responseCode: code, responseBody: body, latencyMs: latency, error, status: ok ? "success" : opts.final ? "failed" : "pending", deliveredAt: ok ? new Date() : null },
  });
  await db.webhook.update({ where: { id: hook.id }, data: { lastDeliveryAt: new Date(), failureCount: ok ? 0 : { increment: 1 } } });
  await addUsage(subjectOf({ userId: hook.ownerId, orgId: hook.orgId }), "webhookDeliveries", 1);
  if (!ok) {
    const fresh = await db.webhook.findUnique({ where: { id: hook.id } });
    if (fresh && fresh.enabled && fresh.failureCount >= 25) {
      await db.webhook.update({ where: { id: hook.id }, data: { enabled: false } });
      const { notify } = await import("./notifications");
      await notify({ userId: hook.ownerId, type: "security_event", title: `Webhook “${hook.name}” was disabled`, body: "It failed 25 deliveries in a row. Fix the endpoint and re-enable it.", href: "/developer/webhooks" });
    }
    if (!opts.final) throw new Error(error ?? "Delivery failed");
  }
  return deliveryDto(updated);
}

/** Sends a signed `webhook.test` event immediately and returns what happened. */
export async function testWebhook(actor: Actor, id: string): Promise<DeliveryDto> {
  await gate(actor);
  const settings = await getSettings();
  rate.enforce(`webhook-test:${actor.user.id}`, settings.rateLimits.webhookTest);
  const hook = await ownedWebhook(actor, id);
  const payload = JSON.stringify({ id: newId("evt"), type: "webhook.test", createdAt: new Date().toISOString(), data: { message: "This is a test delivery from Cairn.", webhook: hook.name } });
  const delivery = await db.webhookDelivery.create({ data: { id: newId("wdl"), webhookId: id, eventId: newId("evt"), event: "webhook.test", payload, status: "pending" } });
  return attemptDelivery(delivery.id, { final: true });
}

/** Re-sends a past delivery's payload as a new delivery (same event id, fresh delivery id and signature). */
export async function replayDelivery(actor: Actor, webhookId: string, deliveryId: string): Promise<DeliveryDto> {
  await gate(actor);
  await ownedWebhook(actor, webhookId);
  const old = await db.webhookDelivery.findFirst({ where: { id: deliveryId, webhookId } });
  if (!old) throw Errors.notFound("That delivery doesn't exist.");
  const delivery = await db.webhookDelivery.create({ data: { id: newId("wdl"), webhookId, eventId: old.eventId, event: old.event, payload: old.payload, status: "pending" } });
  return attemptDelivery(delivery.id, { final: true });
}

export { EVENTS };
export { workspaceIdOf };
