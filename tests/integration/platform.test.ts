import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BASE, Client, adminClient, assignPlan, randomData, registerUser, setSettings, uploadFile, waitFor } from "./helpers";

const WEBHOOK_SECRET = "whsec_integration_test_secret";
let admin: Client;
beforeAll(async () => {
  admin = await adminClient();
});
afterAll(async () => {
  await setSettings(admin, { billing: { provider: "none" }, maintenance: { enabled: false } });
});

async function stripeEvent(event: object, opts: { secret?: string; timestamp?: number; tamper?: boolean } = {}) {
  const body = JSON.stringify(event);
  const t = opts.timestamp ?? Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", opts.secret ?? WEBHOOK_SECRET).update(`${t}.${body}`).digest("hex");
  return fetch(`${BASE}/api/v1/billing/stripe-webhook`, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": `t=${t},v1=${sig}`, "x-forwarded-for": "10.9.9.9" }, body: opts.tamper ? body.replace("evt_", "evx_") : body });
}

describe("billing without a payment provider", () => {
  it("is honest: no fake checkout, admin-assigned plans, self-service cancellation", async () => {
    await setSettings(admin, { billing: { provider: "none" } });
    const { client, id } = await registerUser("bill-none");
    const state = (await client.get("/api/v1/billing")).body;
    expect(state).toMatchObject({ provider: "none", plan: { key: "free" }, subscription: null, canManage: true });
    expect(state.plans.map((p: any) => p.key)).toEqual(["free", "pro", "business"]);
    expect(state.plans.every((p: any) => p.purchasable === false)).toBe(true);
    const checkout = await client.post("/api/v1/billing", { action: "checkout", plan: "pro", interval: "month" });
    expect(checkout.status).toBe(409);
    expect((await client.post("/api/v1/billing", { action: "cancel" })).status).toBe(409); // nothing to cancel on the free plan

    await assignPlan(admin, id, "pro");
    const after = (await client.get("/api/v1/billing")).body;
    expect(after.plan.key).toBe("pro");
    expect(after.subscription).toMatchObject({ planKey: "pro", status: "active", managedBy: "administrator" });
    expect(after.history.map((h: any) => h.type)).toContain("plan_changed");
    expect((await client.get("/api/v1/notifications")).body.items.map((n: any) => n.type)).toContain("subscription_changed");

    const canceled = await client.post("/api/v1/billing", { action: "cancel" });
    expect(canceled.status).toBe(200);
    expect((await client.get("/api/v1/billing")).body.plan.key).toBe("free");
    expect((await client.get("/api/v1/auth/me")).body.plan.features.webhooks).toBe(false);
  });

  it("schedules cancellation for the end of a paid period and can resume it", async () => {
    const { client, id } = await registerUser("bill-period");
    await admin.post("/api/v1/admin/subscriptions", { subjectType: "user", subjectId: id, planKey: "pro", periodEnd: new Date(Date.now() + 5 * 86400_000).toISOString() });
    const res = await client.post("/api/v1/billing", { action: "cancel" });
    expect(res.body.endsAt).toBeTruthy();
    const mid = (await client.get("/api/v1/billing")).body;
    expect(mid.plan.key).toBe("pro"); // still paid until the period ends
    expect(mid.subscription.cancelAtPeriodEnd).toBe(true);
    expect((await client.post("/api/v1/billing", { action: "resume" })).status).toBe(200);
    expect((await client.get("/api/v1/billing")).body.subscription.cancelAtPeriodEnd).toBe(false);
  });

  it("keeps organization billing to owners and admins", async () => {
    const { client, id } = await registerUser("bill-org");
    await assignPlan(admin, id, "business");
    const org = (await client.post("/api/v1/organizations", { name: "Billing Org" })).body.organization;
    const member = await registerUser("bill-org-member");
    const inv = (await client.post(`/api/v1/organizations/${org.id}/invites`, { email: member.email, role: "member" })).body;
    await member.client.post(`/api/v1/invites/${/invite\/([A-Za-z0-9_-]+)/.exec(inv.link)![1]}`);
    const ws = { headers: { "x-cairn-workspace": org.id } };
    // The workspace header decides which billing subject is shown.
    expect((await client.get("/api/v1/billing", ws)).body.subject).toEqual({ type: "org", id: org.id });
    expect((await member.client.get("/api/v1/billing", ws)).body.canManage).toBe(false);
    expect((await member.client.post("/api/v1/billing", { action: "cancel" }, ws)).status).toBe(403);
  });
});

describe("billing with Stripe (signed webhooks)", () => {
  it("rejects unsigned, mis-signed, tampered and stale webhook calls", async () => {
    const event = { id: "evt_bad1", type: "checkout.session.completed", data: { object: {} } };
    expect((await fetch(`${BASE}/api/v1/billing/stripe-webhook`, { method: "POST", body: JSON.stringify(event) })).status).toBe(400);
    expect((await stripeEvent(event, { secret: "whsec_wrong" })).status).toBe(400);
    expect((await stripeEvent(event, { tamper: true })).status).toBe(400);
    expect((await stripeEvent(event, { timestamp: Math.floor(Date.now() / 1000) - 3600 })).status).toBe(400);
  });

  it("moves an account between plans from verified events, idempotently, and downgrades on cancellation", async () => {
    await setSettings(admin, { billing: { provider: "stripe" } });
    await admin.patch("/api/v1/admin/plans/pro", { stripe: { month: "price_pro_month_test", year: "price_pro_year_test" } });
    const { client, id } = await registerUser("bill-stripe");
    const state = (await client.get("/api/v1/billing")).body;
    expect(state.provider).toBe("stripe");
    expect(state.plans.find((p: any) => p.key === "pro").purchasable).toBe(true);
    expect(state.plans.find((p: any) => p.key === "business").purchasable).toBe(false); // no price configured: can't be bought

    const done = { id: "evt_co_1", type: "checkout.session.completed", data: { object: { customer: "cus_123", subscription: "sub_test_1", metadata: { subjectType: "user", subjectId: id, planKey: "pro", interval: "month" } } } };
    expect((await (await stripeEvent(done)).json()).handled).toBe(true);
    expect((await client.get("/api/v1/auth/me")).body.plan.key).toBe("pro");
    const bill = (await client.get("/api/v1/billing")).body;
    expect(bill.subscription).toMatchObject({ planKey: "pro", status: "active", managedBy: "stripe", interval: "month" });
    await stripeEvent(done); // delivered twice
    expect((await client.get("/api/v1/billing")).body.history.filter((h: any) => h.type === "subscription_created")).toHaveLength(1);

    const period = Math.floor(Date.now() / 1000) + 20 * 86400;
    await stripeEvent({ id: "evt_up_1", type: "customer.subscription.updated", data: { object: { id: "sub_test_1", status: "active", cancel_at_period_end: true, current_period_end: period, items: { data: [{ price: { id: "price_pro_month_test" } }] } } } });
    const scheduled = (await client.get("/api/v1/billing")).body.subscription;
    expect(scheduled).toMatchObject({ cancelAtPeriodEnd: true, planKey: "pro" });
    expect(new Date(scheduled.currentPeriodEnd).getTime() / 1000).toBeCloseTo(period, -1);

    await stripeEvent({ id: "evt_pf_1", type: "invoice.payment_failed", data: { object: { subscription: "sub_test_1", amount_due: 900, currency: "usd" } } });
    expect((await client.get("/api/v1/billing")).body.subscription.status).toBe("past_due");
    expect((await client.get("/api/v1/notifications")).body.items.some((n: any) => /payment failed/i.test(n.title))).toBe(true);
    await stripeEvent({ id: "evt_ps_1", type: "invoice.payment_succeeded", data: { object: { subscription: "sub_test_1", amount_paid: 900, currency: "usd" } } });
    expect((await client.get("/api/v1/billing")).body.history.find((h: any) => h.type === "payment_succeeded")).toMatchObject({ amountCents: 900, currency: "usd", provider: "stripe" });

    await stripeEvent({ id: "evt_del_1", type: "customer.subscription.deleted", data: { object: { id: "sub_test_1", status: "canceled" } } });
    expect((await client.get("/api/v1/auth/me")).body.plan.key).toBe("free");
    await setSettings(admin, { billing: { provider: "none" } });
  });

  it("refuses to start checkout for a plan without a configured price and never leaks keys", async () => {
    await setSettings(admin, { billing: { provider: "stripe" } });
    const { client } = await registerUser("bill-noprice");
    const res = await client.post("/api/v1/billing", { action: "checkout", plan: "business", interval: "month" });
    expect(res.status).toBe(422);
    expect(JSON.stringify((await client.get("/api/v1/billing")).body)).not.toMatch(/sk_test|whsec_/);
    await setSettings(admin, { billing: { provider: "none" } });
  });
});

describe("support, changelog and status", () => {
  it("lets people open tickets and administrators answer them", async () => {
    const { client } = await registerUser("ticket");
    expect((await client.post("/api/v1/support/tickets", { category: "bug", subject: "x", body: "short" })).status).toBe(422);
    const ticket = (await client.post("/api/v1/support/tickets", { category: "billing", subject: "Change my plan", body: "Please move me to Pro, thanks." })).body.ticket;
    expect(ticket).toMatchObject({ category: "billing", status: "open" });
    const listed = (await admin.get("/api/v1/admin/tickets")).body.items;
    expect(listed.find((t: any) => t.id === ticket.id).requester.email).toBeTruthy();
    const replied = await admin.post(`/api/v1/admin/tickets/${ticket.id}`, { body: "Done: you're on Pro now.", status: "answered" });
    expect(replied.body.messages.map((m: any) => m.staff)).toEqual([false, true]);
    const mine = (await client.get(`/api/v1/support/tickets/${ticket.id}`)).body;
    expect(mine.ticket.status).toBe("answered");
    expect(mine.messages[1]).toMatchObject({ staff: true, author: "Support" });
    expect((await client.get("/api/v1/notifications")).body.items.some((n: any) => /Support replied/.test(n.title))).toBe(true);
    const followUp = await client.post(`/api/v1/support/tickets/${ticket.id}`, { body: "Thank you!" });
    expect(followUp.body.ticket.status).toBe("open");
    // Tickets are private, and admin inboxes are admin-only.
    const { client: other } = await registerUser("ticket-other");
    expect((await other.get(`/api/v1/support/tickets/${ticket.id}`)).status).toBe(404);
    expect((await other.get("/api/v1/admin/tickets")).status).toBe(403);
    expect((await client.del(`/api/v1/support/tickets/${ticket.id}`)).status).toBe(204);
    expect((await client.post(`/api/v1/support/tickets/${ticket.id}`, { body: "more" })).status).toBe(409);
  });

  it("publishes changelog entries only when an administrator publishes them", async () => {
    const draft = (await admin.post("/api/v1/admin/changelog", { title: "Secret draft entry", body: "Not yet", kind: "feature" })).body.entry;
    const anon = new Client();
    expect((await anon.get("/api/v1/public/changelog")).body.items.some((e: any) => e.id === draft.id)).toBe(false);
    await admin.patch(`/api/v1/admin/changelog/${draft.id}`, { publish: true, version: "1.2.3" });
    const pub = (await anon.get("/api/v1/public/changelog")).body.items.find((e: any) => e.id === draft.id);
    expect(pub).toMatchObject({ title: "Secret draft entry", version: "1.2.3" });
    expect((await admin.del(`/api/v1/admin/changelog/${draft.id}`)).status).toBe(204);
    expect((await anon.get("/api/v1/public/changelog")).body.items.some((e: any) => e.id === draft.id)).toBe(false);
    const { client } = await registerUser("cl-user");
    expect((await client.post("/api/v1/admin/changelog", { title: "Hacked", body: "x", kind: "fix" })).status).toBe(403);
  });

  it("builds the status page from real health checks and posted incidents", async () => {
    const health = (await admin.get("/api/v1/admin/health")).body;
    expect(health.checks.map((c: any) => c.service)).toEqual(expect.arrayContaining(["database", "storage", "jobs"]));
    expect(health.checks.every((c: any) => c.ok)).toBe(true);
    expect(health.email).toEqual({ configured: false, provider: "none" });
    const status = (await new Client().get("/api/v1/public/status")).body;
    expect(status.overall).toBe("operational");
    const db = status.services.find((s: any) => s.key === "database");
    expect(db).toMatchObject({ ok: true });
    expect(db.latencyMs).not.toBeNull();
    expect(status.services.find((s: any) => s.key === "scanner")).toBeUndefined(); // not configured, so not shown as if it were healthy
    const inc = (await admin.post("/api/v1/admin/incidents", { title: "Slow uploads", body: "We are investigating.", severity: "minor", services: ["storage"] })).body.incident;
    const during = (await new Client().get("/api/v1/public/status")).body;
    expect(during.overall).toBe("degraded");
    expect(during.incidents.map((i: any) => i.id)).toContain(inc.id);
    await admin.patch(`/api/v1/admin/incidents/${inc.id}`, { status: "resolved", body: "Fixed." });
    const after = (await new Client().get("/api/v1/public/status")).body;
    expect(after.overall).toBe("operational");
    expect(after.recent.map((i: any) => i.id)).toContain(inc.id);
  });
});

describe("administration of the platform", () => {
  it("reviews quarantined files, lists shares/orgs/jobs and flips feature flags", async () => {
    const { client } = await registerUser("adm-review");
    const up = await uploadFile(client, { data: randomData(120), name: "flagged.bin", share: true });
    await admin.post(`/api/v1/admin/files/${up.file.id}`, { action: "quarantine", note: "Manual review" });
    const q = (await admin.get("/api/v1/admin/quarantine?state=pending")).body.items.find((i: any) => i.fileId === up.file.id);
    expect(q).toMatchObject({ fileName: "flagged.bin", state: "pending", source: "admin" });
    expect((await admin.post(`/api/v1/admin/quarantine/${up.file.id}`, { action: "confirm", note: "Confirmed bad" })).status).toBe(200);
    const release = await admin.post(`/api/v1/admin/quarantine/${up.file.id}`, { action: "release" });
    expect(release.status).toBe(409); // confirmed malicious files can't be released by mistake
    expect((await admin.post(`/api/v1/admin/quarantine/${up.file.id}`, { action: "delete" })).status).toBe(200);
    expect((await client.get(`/api/v1/files/${up.file.id}`)).status).toBe(404);

    const shared = await uploadFile(client, { data: randomData(50), name: "shareme.bin", share: true });
    const shares = (await admin.get("/api/v1/admin/shares?status=active")).body.items;
    const mine = shares.find((s: any) => s.token === shared.file.share.token);
    expect(mine.ownerEmail).toBeTruthy();
    expect((await admin.del(`/api/v1/admin/shares/${mine.id}`)).status).toBe(204);
    expect((await new Client().get(`/dl/${shared.file.share.token}`)).status).toBe(410);

    const jobs = (await admin.get("/api/v1/admin/jobs")).body;
    expect(jobs.counts).toBeTypeOf("object");
    expect((await admin.get("/api/v1/admin/orgs")).status).toBe(200);
    expect((await admin.get("/api/v1/admin/api")).body).toHaveProperty("requests24h");
    expect((await admin.get("/api/v1/admin/subscriptions")).status).toBe(200);
    expect((await admin.get("/api/v1/admin/email")).body.status).toEqual({ configured: false, provider: "none" });

    // A flag switches a capability off for everyone, whatever their plan.
    const { client: pro, id } = await registerUser("adm-flag");
    await assignPlan(admin, id, "pro");
    expect((await pro.post("/api/v1/webhooks", { name: "w", url: "https://example.com/h", events: ["*"] })).status).toBe(201);
    await admin.put("/api/v1/admin/flags/webhooks", { enabled: false });
    const blocked = await pro.post("/api/v1/webhooks", { name: "w2", url: "https://example.com/h", events: ["*"] });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("feature_disabled");
    await admin.put("/api/v1/admin/flags/webhooks", { enabled: true });
    expect((await pro.post("/api/v1/webhooks", { name: "w3", url: "https://example.com/h", events: ["*"] })).status).toBe(201);
  });

  it("creates database backups on demand and lists them", async () => {
    const res = await admin.post("/api/v1/admin/backups");
    expect(res.status).toBe(201);
    const latest = res.body.items[0];
    expect(latest).toMatchObject({ status: "ok" });
    expect(latest.size).toBeGreaterThan(1000);
    const { client } = await registerUser("adm-backup");
    expect((await client.post("/api/v1/admin/backups")).status).toBe(403);
    void waitFor;
  });

  it("gives moderators a recovery path and audits sensitive admin actions", async () => {
    const { id } = await registerUser("adm-audit");
    await admin.patch(`/api/v1/admin/users/${id}`, { status: "suspended", suspendedReason: "test" });
    await admin.post(`/api/v1/admin/users/${id}/recovery-link`);
    await assignPlan(admin, id, "pro");
    const actions = (await admin.get(`/api/v1/admin/audit?actorId=${id}&limit=100`)).body.items.map((e: any) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["admin.user_suspended", "auth.password_reset", "billing.subscription_changed", "admin.plan_changed"]));
  });
});
