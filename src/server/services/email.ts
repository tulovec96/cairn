import { db } from "../db";
import { env } from "../env";
import { newId } from "../ids";

/**
 * Email abstraction. Messages are always written to an outbox table first; a provider then delivers
 * them. With no provider configured (the default) messages are recorded as "skipped": nothing is sent
 * and nothing pretends to be. Add a provider by implementing `EmailProvider` and registering it in
 * `activeProvider()`.
 */
export interface EmailMessageInput {
  userId?: string | null;
  to: string;
  template: string;
  subject: string;
  body: string;
}

export interface EmailProvider {
  readonly name: string;
  send(message: { to: string; subject: string; body: string }): Promise<void>;
}

/** Minimal HTTP provider: POSTs the message as JSON to EMAIL_WEBHOOK_URL (for a relay you control). */
class HttpRelayProvider implements EmailProvider {
  readonly name = "http-relay";
  constructor(private readonly url: string, private readonly token: string | undefined) {}
  async send(message: { to: string; subject: string; body: string }) {
    const res = await fetch(this.url, {
      method: "POST",
      headers: { "content-type": "application/json", ...(this.token ? { authorization: `Bearer ${this.token}` } : {}) },
      body: JSON.stringify({ from: process.env.EMAIL_FROM ?? `no-reply@${new URL(env.appUrl).hostname}`, ...message }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Email relay responded ${res.status}`);
  }
}

export function activeProvider(): EmailProvider | null {
  const url = process.env.EMAIL_WEBHOOK_URL;
  return url ? new HttpRelayProvider(url, process.env.EMAIL_WEBHOOK_TOKEN) : null;
}

export async function queueEmail(input: EmailMessageInput): Promise<string> {
  const provider = activeProvider();
  const row = await db.emailMessage.create({
    data: {
      id: newId("eml"),
      userId: input.userId ?? null,
      toEmail: input.to,
      template: input.template,
      subject: input.subject.slice(0, 300),
      body: input.body.slice(0, 20_000),
      status: provider ? "queued" : "skipped",
      provider: provider?.name ?? "none",
    },
  });
  if (provider) {
    const { enqueueJob } = await import("../jobs/queue");
    await enqueueJob("send_email", { emailId: row.id }, { dedupeKey: `email:${row.id}`, maxAttempts: 4 });
  }
  return row.id;
}

export async function deliverEmail(emailId: string): Promise<void> {
  const row = await db.emailMessage.findUnique({ where: { id: emailId } });
  const provider = activeProvider();
  if (!row || row.status === "sent" || !provider) return;
  try {
    await provider.send({ to: row.toEmail, subject: row.subject, body: row.body });
    await db.emailMessage.update({ where: { id: emailId }, data: { status: "sent", sentAt: new Date(), error: null } });
  } catch (err) {
    await db.emailMessage.update({ where: { id: emailId }, data: { status: "failed", error: (err as Error).message.slice(0, 300) } });
    throw err;
  }
}

export function emailStatus(): { configured: boolean; provider: string } {
  const p = activeProvider();
  return { configured: !!p, provider: p?.name ?? "none" };
}
