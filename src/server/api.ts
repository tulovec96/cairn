import { z } from "zod";
import { isUnlimited } from "@/config/entitlements";
import { Errors } from "./errors";
import { type Ctx, idParam } from "./http";
import * as rate from "./ratelimit";
import { getSettings } from "./settings";
import { assertScope, resolveActor, requireAdmin, requireSessionUser, type Actor } from "./services/actor";
import { assertFeature } from "./services/entitlements";
import { entitlementsForActor } from "./services/limits";
import type { Scope } from "@/lib/types";

/**
 * API-key traffic is limited by the plan (requests per minute, per account); browser sessions and
 * anonymous traffic use the site-wide rule from settings.
 */
async function limitApi(actor: Actor | null, ip: string) {
  const settings = await getSettings();
  if (actor?.via === "apikey") {
    const ent = await entitlementsForActor(actor);
    await assertFeature(ent, "api");
    const perMinute = ent.limits.apiRequestsPerMinute;
    if (!isUnlimited(perMinute)) rate.enforce(`api:key:${actor.user.id}`, { limit: perMinute, windowSec: 60 }, "You've hit your plan's API rate limit. Slow down or upgrade for a higher limit.");
    return;
  }
  rate.enforce(actor ? `api:u:${actor.user.id}` : `api:ip:${ip}`, settings.rateLimits.api);
}

/** Authenticates the caller (session cookie or API key), applies the API rate limit and checks the scope. */
export async function caller(ctx: Ctx<unknown>, scope?: Scope): Promise<Actor> {
  const actor = await resolveActor(ctx.req);
  await limitApi(actor, ctx.ip);
  if (!actor) throw Errors.unauthorized();
  if (scope) assertScope(actor, scope);
  if (actor.via === "apikey" && actor.apiKeyId) ctx.usage = { userId: actor.user.id, apiKeyId: actor.apiKeyId };
  return actor;
}

/** Account-management endpoints: browser sessions only, so an API key can never change credentials or settings. */
export async function sessionCaller(ctx: Ctx<unknown>): Promise<Actor> {
  const actor = await requireSessionUser(ctx.req);
  await limitApi(actor, ctx.ip);
  return actor;
}

export const userCaller =(ctx: Ctx<unknown>, scope?: Scope): Promise<Actor> => caller(ctx, scope);

export async function optionalCaller(ctx: Ctx<unknown>): Promise<Actor | null> {
  const actor = await resolveActor(ctx.req);
  await limitApi(actor, ctx.ip);
  if (actor?.via === "apikey" && actor.apiKeyId) ctx.usage = { userId: actor.user.id, apiKeyId: actor.apiKeyId };
  return actor;
}

export async function adminCaller(ctx: Ctx<unknown>): Promise<Actor> {
  const admin = await requireAdmin(ctx.req);
  await limitApi(admin, ctx.ip);
  return admin;
}

export const isoDateTime = z
  .string()
  .datetime({ offset: true, message: "Use an ISO 8601 date-time, e.g. 2030-01-31T12:00:00Z." })
  .transform((s) => new Date(s));

export const nullableId = z
  .union([idParam, z.literal("root"), z.literal("")])
  .nullable()
  .transform((v) => (v === "root" || v === "" || v === null ? null : v));

export const hex64 = z.string().regex(/^[a-fA-F0-9]{64}$/, "Must be a 64 character hex SHA-256.");
