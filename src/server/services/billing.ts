import { createHmac, timingSafeEqual } from "node:crypto";
import type { Subscription } from "@prisma/client";
import { isUnlimited } from "@/config/entitlements";
import { db } from "../db";
import { env } from "../env";
import { Errors } from "../errors";
import { emit } from "../events";
import { newId } from "../ids";
import { getSettings } from "../settings";
import { formatBytes } from "@/lib/format";
import { audit } from "./audit";
import { defaultPlanKey, getPlan, listPlans, type PlanRecord } from "./entitlements";
import { notify } from "./notifications";
import { assertCan } from "./permissions";
import { storageUsedBytes } from "./limits";
import type { Actor } from "./actor";

/**
 * Billing sits behind a provider switch (Settings → Billing):
 *  - "none": nothing is charged. Plans are assigned by an administrator; people can request a change through
 *    support and cancel a paid plan themselves. The UI says so plainly; there is no pretend checkout.
 *  - "stripe": Checkout for upgrades, the Stripe customer portal for payment methods and invoices, and signed
 *    webhooks keep plans in sync. Needs STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET in the environment and a
 *    Stripe price id per plan/interval (admin → plans).
 * Entitlements always come from the plan stored on the user/organization; providers only decide when that changes.
 */

export type Subject = { type: "user" | "org"; id: string };

export interface SubscriptionDto {
  planKey: string;
  planName: string;
  status: string;
  interval: "month" | "year";
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  provider: string;
  managedBy: "administrator" | "stripe";
}

export interface BillingState {
  subject: Subject;
  provider: "none" | "stripe";
  providerConfigured: boolean;
  plan: { key: string; name: string; priceMonthlyCents: number; priceYearlyCents: number; currency: string };
  subscription: SubscriptionDto | null;
  canManage: boolean;
  plans: Array<{ key: string; name: string; description: string; priceMonthlyCents: number; priceYearlyCents: number; currency: string; current: boolean; purchasable: boolean }>;
  history: Array<{ id: string; type: string; amountCents: number | null; currency: string | null; createdAt: string; provider: string }>;
}

const stripeKey = () => process.env.STRIPE_SECRET_KEY || "";
const stripeWebhookSecret = () => process.env.STRIPE_WEBHOOK_SECRET || "";

export async function activeProvider(): Promise<"none" | "stripe"> {
  const settings = await getSettings();
  return settings.billing.provider === "stripe" ? "stripe" : "none";
}

export const stripeConfigured = () => !!stripeKey() && !!stripeWebhookSecret();

async function subjectRecord(subject: Subject) {
  if (subject.type === "org") {
    const org = await db.organization.findUnique({ where: { id: subject.id } });
    if (!org) throw Errors.notFound("That organization doesn't exist.");
    return { planKey: org.planKey, name: org.name, ownerId: org.ownerId };
  }
  const user = await db.user.findUnique({ where: { id: subject.id } });
  if (!user) throw Errors.notFound();
  return { planKey: user.planKey, name: user.displayName, ownerId: user.id };
}

const subjectWhere = (s: Subject) => (s.type === "org" ? { orgId: s.id } : { userId: s.id });

/** Billing subject for the workspace the actor is in. Managing an organization's plan needs the "manage" permission. */
export function subjectFor(actor: Actor): Subject {
  return actor.workspace.orgId ? { type: "org", id: actor.workspace.orgId } : { type: "user", id: actor.user.id };
}

function toSubscriptionDto(s: Subscription, plan: PlanRecord): SubscriptionDto {
  return {
    planKey: s.planKey,
    planName: plan.name,
    status: s.status,
    interval: s.interval as "month" | "year",
    currentPeriodEnd: s.currentPeriodEnd?.toISOString() ?? null,
    cancelAtPeriodEnd: s.cancelAtPeriodEnd,
    provider: s.provider,
    managedBy: s.provider === "stripe" ? "stripe" : "administrator",
  };
}

export async function getBillingState(actor: Actor): Promise<BillingState> {
  const subject = subjectFor(actor);
  const record = await subjectRecord(subject);
  const [plans, provider, sub, events] = await Promise.all([
    listPlans({ publicOnly: true }),
    activeProvider(),
    db.subscription.findFirst({ where: { ...subjectWhere(subject), status: { not: "canceled" } }, orderBy: { createdAt: "desc" } }),
    db.billingEvent.findMany({ where: subjectWhere(subject), orderBy: { createdAt: "desc" }, take: 30 }),
  ]);
  const plan = await getPlan(record.planKey);
  const configured = provider === "stripe" && stripeConfigured();
  return {
    subject,
    provider,
    providerConfigured: provider === "none" ? true : configured,
    plan: { key: plan.key, name: plan.name, priceMonthlyCents: plan.priceMonthlyCents, priceYearlyCents: plan.priceYearlyCents, currency: plan.currency },
    subscription: sub ? toSubscriptionDto(sub, plan) : null,
    canManage: subject.type === "user" ? true : actor.workspace.role === "owner" || actor.workspace.role === "admin",
    plans: plans.map((p) => ({
      key: p.key,
      name: p.name,
      description: p.description,
      priceMonthlyCents: p.priceMonthlyCents,
      priceYearlyCents: p.priceYearlyCents,
      currency: p.currency,
      current: p.key === plan.key,
      purchasable: p.priceMonthlyCents > 0 && configured && !!(p.providerPrices.stripe?.month || p.providerPrices.stripe?.year),
    })),
    history: events.map((e) => ({ id: e.id, type: e.type, amountCents: e.amountCents, currency: e.currency, createdAt: e.createdAt.toISOString(), provider: e.provider })),
  };
}

/** Refuses a plan change that would leave the account over the new plan's limits. Nothing is ever deleted to make room. */
async function assertFits(subject: Subject, plan: PlanRecord) {
  const used = await storageUsedBytes({ userId: subject.type === "user" ? subject.id : "", orgId: subject.type === "org" ? subject.id : null });
  const total = used.stored + used.pending;
  if (!isUnlimited(plan.limits.storageBytes) && total > plan.limits.storageBytes) {
    throw Errors.conflict(`You're using ${formatBytes(total)}, which is more than ${plan.name} includes (${formatBytes(plan.limits.storageBytes)}). Free up space before switching.`);
  }
  if (subject.type === "org" && !isUnlimited(plan.limits.orgMembers)) {
    const members = await db.organizationMember.count({ where: { orgId: subject.id } });
    if (members > plan.limits.orgMembers) throw Errors.conflict(`This organization has ${members} members; ${plan.name} allows ${plan.limits.orgMembers}. Remove members first.`);
  }
}

interface AssignOptions {
  interval?: "month" | "year";
  provider?: string;
  by?: { type: "admin" | "user" | "system"; id?: string | null };
  providerCustomerId?: string | null;
  providerSubscriptionId?: string | null;
  periodEnd?: Date | null;
  status?: string;
  skipFitCheck?: boolean;
  eventType?: string;
  providerEventId?: string;
}

/** The single place where a plan changes. Everything else (admin panel, Stripe webhooks, cancellations) goes through here. */
export async function assignPlan(subject: Subject, planKey: string, opts: AssignOptions = {}): Promise<void> {
  const plan = (await listPlans()).find((p) => p.key === planKey);
  if (!plan) throw Errors.validation("That plan doesn't exist.");
  const record = await subjectRecord(subject);
  if (!opts.skipFitCheck && record.planKey !== planKey) await assertFits(subject, plan);
  const before = record.planKey;
  const provider = opts.provider ?? "internal";
  const existing = await db.subscription.findFirst({ where: { ...subjectWhere(subject), status: { not: "canceled" } }, orderBy: { createdAt: "desc" } });
  const data = {
    planKey,
    status: opts.status ?? "active",
    interval: opts.interval ?? existing?.interval ?? "month",
    provider,
    currentPeriodEnd: opts.periodEnd === undefined ? (existing?.currentPeriodEnd ?? null) : opts.periodEnd,
    cancelAtPeriodEnd: false,
    canceledAt: null,
    ...(opts.providerCustomerId !== undefined ? { providerCustomerId: opts.providerCustomerId } : {}),
    ...(opts.providerSubscriptionId !== undefined ? { providerSubscriptionId: opts.providerSubscriptionId } : {}),
  };
  const sub =
    plan.priceMonthlyCents === 0 && provider !== "stripe"
      ? existing
        ? await db.subscription.update({ where: { id: existing.id }, data: { status: "canceled", canceledAt: new Date(), planKey } })
        : null
      : existing
        ? await db.subscription.update({ where: { id: existing.id }, data })
        : await db.subscription.create({ data: { id: newId("sub"), ...subjectWhere(subject), ...data } });

  if (subject.type === "org") await db.organization.update({ where: { id: subject.id }, data: { planKey } });
  else await db.user.update({ where: { id: subject.id }, data: { planKey } });

  const changed = before !== planKey;
  await db.billingEvent.create({
    data: {
      id: newId("bil"),
      subscriptionId: sub?.id ?? null,
      ...(subject.type === "org" ? { orgId: subject.id } : { userId: subject.id }),
      type: opts.eventType ?? (changed ? "plan_changed" : "renewed"),
      provider,
      providerEventId: opts.providerEventId ?? null,
      data: JSON.stringify({ from: before, to: planKey, by: opts.by?.type ?? "system" }),
    },
  });
  if (changed) {
    await audit({ actorType: opts.by?.type === "admin" ? "admin" : opts.by?.type === "user" ? "user" : "system", actorId: opts.by?.id ?? null, action: "billing.subscription_changed", targetType: subject.type, targetId: subject.id, metadata: { from: before, to: planKey, provider } });
    await notify({ userId: record.ownerId, type: "subscription_changed", title: `Your plan is now ${plan.name}`, body: `${subject.type === "org" ? `${record.name} moved` : "You moved"} from ${(await getPlan(before)).name} to ${plan.name}.`, href: "/settings/billing" });
    await emit({ type: "subscription.changed", workspaceId: subject.id, ownerId: record.ownerId, orgId: subject.type === "org" ? subject.id : null, data: { from: before, to: planKey } });
  }
}

/** Cancels a paid plan. Stripe-managed subscriptions are cancelled at the provider and end with the paid period. */
export async function cancelSubscription(actor: Actor): Promise<{ endsAt: string | null }> {
  const subject = subjectFor(actor);
  if (subject.type === "org") assertCan(actor, "manage");
  const sub = await db.subscription.findFirst({ where: { ...subjectWhere(subject), status: { not: "canceled" } }, orderBy: { createdAt: "desc" } });
  if (!sub) throw Errors.conflict("There's no paid plan to cancel.");
  if (sub.provider === "stripe" && sub.providerSubscriptionId) {
    await stripeRequest(`/subscriptions/${sub.providerSubscriptionId}`, { "cancel_at_period_end": "true" });
    await db.subscription.update({ where: { id: sub.id }, data: { cancelAtPeriodEnd: true } });
    await db.billingEvent.create({ data: { id: newId("bil"), subscriptionId: sub.id, ...(subject.type === "org" ? { orgId: subject.id } : { userId: subject.id }), type: "cancel_scheduled", provider: "stripe" } });
    await audit({ actorType: "user", actorId: actor.user.id, action: "billing.subscription_canceled", targetType: subject.type, targetId: subject.id, metadata: { atPeriodEnd: true } });
    return { endsAt: sub.currentPeriodEnd?.toISOString() ?? null };
  }
  if (sub.currentPeriodEnd && sub.currentPeriodEnd.getTime() > Date.now()) {
    await db.subscription.update({ where: { id: sub.id }, data: { cancelAtPeriodEnd: true } });
    await db.billingEvent.create({ data: { id: newId("bil"), subscriptionId: sub.id, ...(subject.type === "org" ? { orgId: subject.id } : { userId: subject.id }), type: "cancel_scheduled", provider: sub.provider } });
    await audit({ actorType: "user", actorId: actor.user.id, action: "billing.subscription_canceled", targetType: subject.type, targetId: subject.id, metadata: { atPeriodEnd: true } });
    return { endsAt: sub.currentPeriodEnd.toISOString() };
  }
  await assignPlan(subject, await defaultPlanKey(), { by: { type: "user", id: actor.user.id }, eventType: "canceled" });
  await audit({ actorType: "user", actorId: actor.user.id, action: "billing.subscription_canceled", targetType: subject.type, targetId: subject.id, metadata: { atPeriodEnd: false } });
  return { endsAt: null };
}

/** Undoes a scheduled cancellation while the paid period is still running. */
export async function resumeSubscription(actor: Actor): Promise<void> {
  const subject = subjectFor(actor);
  if (subject.type === "org") assertCan(actor, "manage");
  const sub = await db.subscription.findFirst({ where: { ...subjectWhere(subject), status: { not: "canceled" }, cancelAtPeriodEnd: true }, orderBy: { createdAt: "desc" } });
  if (!sub) throw Errors.conflict("Nothing is scheduled to be cancelled.");
  if (sub.provider === "stripe" && sub.providerSubscriptionId) await stripeRequest(`/subscriptions/${sub.providerSubscriptionId}`, { cancel_at_period_end: "false" });
  await db.subscription.update({ where: { id: sub.id }, data: { cancelAtPeriodEnd: false } });
}

/** Applies scheduled cancellations whose paid period has ended (run by the background worker). */
export async function applyScheduledCancellations(): Promise<number> {
  const due = await db.subscription.findMany({ where: { status: { not: "canceled" }, cancelAtPeriodEnd: true, currentPeriodEnd: { lte: new Date() } }, take: 200 });
  const fallback = await defaultPlanKey();
  for (const s of due) {
    const subject: Subject = s.orgId ? { type: "org", id: s.orgId } : { type: "user", id: s.userId! };
    try {
      await assignPlan(subject, fallback, { by: { type: "system" }, eventType: "canceled", skipFitCheck: true });
      await db.subscription.update({ where: { id: s.id }, data: { status: "canceled", canceledAt: new Date() } });
    } catch (err) {
      console.error("[billing] could not apply cancellation", s.id, (err as Error).message);
    }
  }
  return due.length;
}

// ---------------------------------------------------------------------------------------------
// Stripe (plain HTTPS; no SDK)
// ---------------------------------------------------------------------------------------------

function flatten(obj: Record<string, unknown>, prefix = ""): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v === undefined || v === null) continue;
    if (typeof v === "object") out.push(...flatten(v as Record<string, unknown>, key));
    else out.push([key, String(v)]);
  }
  return out;
}

async function stripeRequest(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!stripeConfigured()) throw Errors.conflict("Stripe isn't configured on this server.");
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${stripeKey()}`, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(flatten(body)),
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: { message?: string } };
  if (!res.ok) throw Errors.conflict(`The payment provider refused the request: ${json.error?.message ?? res.status}`);
  return json;
}

export async function startCheckout(actor: Actor, planKey: string, interval: "month" | "year"): Promise<{ url: string }> {
  const subject = subjectFor(actor);
  if (subject.type === "org") assertCan(actor, "manage");
  if ((await activeProvider()) !== "stripe" || !stripeConfigured()) throw Errors.conflict("Online payments aren't enabled on this server. Request the change through support instead.");
  const plan = (await listPlans({ publicOnly: true })).find((p) => p.key === planKey);
  const price = plan?.providerPrices.stripe?.[interval];
  if (!plan || !price) throw Errors.validation("That plan can't be purchased online.");
  await assertFits(subject, plan);
  const existing = await db.subscription.findFirst({ where: { ...subjectWhere(subject), status: { not: "canceled" }, provider: "stripe" }, orderBy: { createdAt: "desc" } });
  const meta = { subjectType: subject.type, subjectId: subject.id, planKey, interval };
  const session = await stripeRequest("/checkout/sessions", {
    mode: "subscription",
    "line_items": { 0: { price, quantity: 1 } },
    success_url: `${env.appUrl}/settings/billing?checkout=success`,
    cancel_url: `${env.appUrl}/settings/billing?checkout=cancelled`,
    client_reference_id: `${subject.type}:${subject.id}`,
    ...(existing?.providerCustomerId ? { customer: existing.providerCustomerId } : { customer_email: actor.user.email }),
    metadata: meta,
    subscription_data: { metadata: meta },
  });
  if (typeof session.url !== "string") throw Errors.conflict("The payment provider didn't return a checkout address.");
  return { url: session.url };
}

export async function billingPortalUrl(actor: Actor): Promise<{ url: string }> {
  const subject = subjectFor(actor);
  if (subject.type === "org") assertCan(actor, "manage");
  const sub = await db.subscription.findFirst({ where: { ...subjectWhere(subject), provider: "stripe", providerCustomerId: { not: null } }, orderBy: { createdAt: "desc" } });
  if (!sub?.providerCustomerId) throw Errors.conflict("There's no card on file yet.");
  const portal = await stripeRequest("/billing_portal/sessions", { customer: sub.providerCustomerId, return_url: `${env.appUrl}/settings/billing` });
  return { url: String(portal.url) };
}

/** Stripe signature check: `t=<unix>,v1=<hmac>` over `<t>.<raw body>`, five minute tolerance, constant-time compare. */
export function verifyStripeSignature(rawBody: string, header: string | null, secret = stripeWebhookSecret(), nowSec = Math.floor(Date.now() / 1000)): boolean {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  const t = Number(parts.t);
  const provided = header.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (!Number.isFinite(t) || Math.abs(nowSec - t) > 300 || !provided.length) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  return provided.some((sig) => sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected)));
}

type StripeObject = Record<string, unknown> & { id?: string };
interface StripeEvent {
  id: string;
  type: string;
  data: { object: StripeObject };
}

function planForPrice(plans: PlanRecord[], priceId: string | undefined): { plan: PlanRecord; interval: "month" | "year" } | null {
  if (!priceId) return null;
  for (const p of plans) {
    if (p.providerPrices.stripe?.month === priceId) return { plan: p, interval: "month" };
    if (p.providerPrices.stripe?.year === priceId) return { plan: p, interval: "year" };
  }
  return null;
}

/** Processes one verified Stripe event. Safe to call twice with the same event (idempotent by event id). */
export async function handleStripeEvent(event: StripeEvent): Promise<{ handled: boolean }> {
  if (await db.billingEvent.findUnique({ where: { providerEventId: event.id } })) return { handled: true };
  const obj = event.data.object;
  const plans = await listPlans();
  const fallback = await defaultPlanKey();
  const subjectFromMeta = (m: unknown): Subject | null => {
    const meta = (m ?? {}) as Record<string, string>;
    return meta.subjectType && meta.subjectId && (meta.subjectType === "user" || meta.subjectType === "org") ? { type: meta.subjectType, id: meta.subjectId } : null;
  };

  switch (event.type) {
    case "checkout.session.completed": {
      const subject = subjectFromMeta(obj.metadata);
      const planKey = (obj.metadata as Record<string, string> | undefined)?.planKey;
      if (!subject || !planKey || !obj.subscription) return { handled: false };
      await assignPlan(subject, planKey, {
        provider: "stripe",
        interval: (obj.metadata as Record<string, string>).interval === "year" ? "year" : "month",
        providerCustomerId: typeof obj.customer === "string" ? obj.customer : null,
        providerSubscriptionId: String(obj.subscription),
        by: { type: "user", id: null },
        skipFitCheck: true,
        eventType: "subscription_created",
        providerEventId: event.id,
      });
      return { handled: true };
    }
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = await db.subscription.findUnique({ where: { providerSubscriptionId: String(obj.id) } });
      if (!sub) return { handled: false };
      const subject: Subject = sub.orgId ? { type: "org", id: sub.orgId } : { type: "user", id: sub.userId! };
      const status = String(obj.status ?? "");
      const periodEnd = typeof obj.current_period_end === "number" ? new Date(obj.current_period_end * 1000) : sub.currentPeriodEnd;
      if (event.type === "customer.subscription.deleted" || status === "canceled" || status === "unpaid" || status === "incomplete_expired") {
        await db.subscription.update({ where: { id: sub.id }, data: { status: "canceled", canceledAt: new Date() } });
        await assignPlan(subject, fallback, { provider: "stripe", by: { type: "system" }, skipFitCheck: true, eventType: "canceled", providerEventId: event.id });
        return { handled: true };
      }
      const items = ((obj.items as { data?: Array<{ price?: { id?: string } }> } | undefined)?.data ?? []) as Array<{ price?: { id?: string } }>;
      const mapped = planForPrice(plans, items[0]?.price?.id);
      await db.subscription.update({
        where: { id: sub.id },
        data: { status: status === "past_due" ? "past_due" : status === "trialing" ? "trialing" : "active", cancelAtPeriodEnd: !!obj.cancel_at_period_end, currentPeriodEnd: periodEnd, ...(mapped ? { interval: mapped.interval } : {}) },
      });
      if (mapped && mapped.plan.key !== sub.planKey) {
        await assignPlan(subject, mapped.plan.key, { provider: "stripe", interval: mapped.interval, periodEnd, skipFitCheck: true, by: { type: "system" }, providerEventId: event.id });
      } else {
        await db.billingEvent.create({ data: { id: newId("bil"), subscriptionId: sub.id, ...(sub.orgId ? { orgId: sub.orgId } : { userId: sub.userId }), type: "subscription_updated", provider: "stripe", providerEventId: event.id, data: JSON.stringify({ status }) } });
      }
      return { handled: true };
    }
    case "invoice.payment_succeeded":
    case "invoice.payment_failed": {
      const sub = await db.subscription.findUnique({ where: { providerSubscriptionId: String(obj.subscription ?? "") } });
      if (!sub) return { handled: false };
      const failed = event.type === "invoice.payment_failed";
      await db.billingEvent.create({
        data: {
          id: newId("bil"),
          subscriptionId: sub.id,
          ...(sub.orgId ? { orgId: sub.orgId } : { userId: sub.userId }),
          type: failed ? "payment_failed" : "payment_succeeded",
          amountCents: typeof obj.amount_paid === "number" && !failed ? obj.amount_paid : typeof obj.amount_due === "number" ? obj.amount_due : null,
          currency: typeof obj.currency === "string" ? obj.currency : null,
          provider: "stripe",
          providerEventId: event.id,
        },
      });
      if (failed) {
        await db.subscription.update({ where: { id: sub.id }, data: { status: "past_due" } });
        const ownerId = sub.userId ?? (await db.organization.findUnique({ where: { id: sub.orgId! }, select: { ownerId: true } }))?.ownerId;
        if (ownerId) await notify({ userId: ownerId, type: "subscription_changed", title: "A payment failed", body: "Update your payment method to keep your plan.", href: "/settings/billing", dedupeKey: `payfail:${sub.id}`, dedupeHours: 24 });
      }
      return { handled: true };
    }
    default:
      return { handled: false };
  }
}
