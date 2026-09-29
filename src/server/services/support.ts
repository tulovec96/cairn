import { z } from "zod";
import type { SupportMessage, SupportTicket } from "@prisma/client";
import { db } from "../db";
import { Errors } from "../errors";
import { newId } from "../ids";
import * as rate from "../ratelimit";
import { getSettings } from "../settings";
import { queueEmail } from "./email";
import { notify } from "./notifications";
import type { Actor } from "./actor";
import { audit } from "./audit";

export const TICKET_CATEGORIES = ["account", "billing", "bug", "feature", "abuse", "other"] as const;

export const ticketSchema = z.object({
  category: z.enum(TICKET_CATEGORIES),
  subject: z.string().trim().min(3, "Add a short subject.").max(150),
  body: z.string().trim().min(10, "Tell us a bit more (at least a sentence).").max(5000),
});
export const replySchema = z.object({ body: z.string().trim().min(1).max(5000) });

export interface TicketDto {
  id: string;
  category: string;
  subject: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  messageCount?: number;
  requester?: { id: string; name: string; email: string };
}

export interface TicketMessageDto {
  id: string;
  body: string;
  staff: boolean;
  author: string | null;
  createdAt: string;
}

const toDto = (t: SupportTicket & { _count?: { messages: number }; user?: { id: string; displayName: string; email: string } }): TicketDto => ({
  id: t.id,
  category: t.category,
  subject: t.subject,
  status: t.status,
  createdAt: t.createdAt.toISOString(),
  updatedAt: t.updatedAt.toISOString(),
  messageCount: t._count?.messages,
  requester: t.user ? { id: t.user.id, name: t.user.displayName, email: t.user.email } : undefined,
});

export async function createTicket(actor: Actor, input: z.infer<typeof ticketSchema>): Promise<TicketDto> {
  const settings = await getSettings();
  rate.enforce(`ticket:${actor.user.id}`, settings.rateLimits.supportTicket, "You've opened several tickets recently. Please wait a little before opening another.");
  const ticket = await db.supportTicket.create({
    data: { id: newId("tkt"), userId: actor.user.id, category: input.category, subject: input.subject, messages: { create: { id: newId("msg"), authorId: actor.user.id, body: input.body } } },
  });
  if (settings.support.contactEmail) {
    await queueEmail({ to: settings.support.contactEmail, template: "support_ticket", subject: `[Cairn support] ${input.subject}`, body: `From ${actor.user.email} (${input.category}):\n\n${input.body}` });
  }
  return toDto(ticket);
}

export async function listMyTickets(actor: Actor): Promise<TicketDto[]> {
  const rows = await db.supportTicket.findMany({ where: { userId: actor.user.id }, orderBy: { updatedAt: "desc" }, take: 100, include: { _count: { select: { messages: true } } } });
  return rows.map(toDto);
}

async function messagesOf(ticket: SupportTicket): Promise<TicketMessageDto[]> {
  const rows: Array<SupportMessage> = await db.supportMessage.findMany({ where: { ticketId: ticket.id }, orderBy: { createdAt: "asc" } });
  const ids = [...new Set(rows.map((r) => r.authorId).filter((x): x is string => !!x))];
  const people = new Map((await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true } })).map((u) => [u.id, u.displayName]));
  return rows.map((m) => ({ id: m.id, body: m.body, staff: m.isStaff, author: m.authorId ? (m.isStaff ? "Support" : (people.get(m.authorId) ?? null)) : null, createdAt: m.createdAt.toISOString() }));
}

export async function getMyTicket(actor: Actor, id: string) {
  const ticket = await db.supportTicket.findFirst({ where: { id, userId: actor.user.id } });
  if (!ticket) throw Errors.notFound("That ticket doesn't exist.");
  return { ticket: toDto(ticket), messages: await messagesOf(ticket) };
}

export async function replyToMyTicket(actor: Actor, id: string, body: string) {
  const ticket = await db.supportTicket.findFirst({ where: { id, userId: actor.user.id } });
  if (!ticket) throw Errors.notFound("That ticket doesn't exist.");
  if (ticket.status === "closed") throw Errors.conflict("This ticket is closed. Open a new one if you still need help.");
  rate.enforce(`ticket-reply:${actor.user.id}`, { limit: 30, windowSec: 3600 });
  await db.supportMessage.create({ data: { id: newId("msg"), ticketId: id, authorId: actor.user.id, body } });
  await db.supportTicket.update({ where: { id }, data: { status: "open" } });
  return getMyTicket(actor, id);
}

export async function closeMyTicket(actor: Actor, id: string) {
  const { count } = await db.supportTicket.updateMany({ where: { id, userId: actor.user.id }, data: { status: "closed" } });
  if (!count) throw Errors.notFound("That ticket doesn't exist.");
}

// ---- Administrators ----

export const adminTicketListSchema = z.object({
  status: z.enum(["open", "answered", "closed", "active"]).default("active"),
  cursor: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export async function adminListTickets(query: z.infer<typeof adminTicketListSchema>) {
  const rows = await db.supportTicket.findMany({
    where: query.status === "active" ? { status: { in: ["open", "answered"] } } : { status: query.status },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    include: { _count: { select: { messages: true } }, user: { select: { id: true, displayName: true, email: true } } },
  });
  const page = rows.slice(0, query.limit);
  return { items: page.map(toDto), nextCursor: rows.length > query.limit ? page[page.length - 1].id : null };
}

export async function adminGetTicket(id: string) {
  const ticket = await db.supportTicket.findUnique({ where: { id }, include: { user: { select: { id: true, displayName: true, email: true } }, _count: { select: { messages: true } } } });
  if (!ticket) throw Errors.notFound("That ticket doesn't exist.");
  return { ticket: toDto(ticket), messages: await messagesOf(ticket) };
}

export const adminReplySchema = z.object({ body: z.string().trim().min(1).max(5000), status: z.enum(["answered", "closed", "open"]).default("answered") });

export async function adminReply(adminId: string, id: string, input: z.infer<typeof adminReplySchema>) {
  const ticket = await db.supportTicket.findUnique({ where: { id } });
  if (!ticket) throw Errors.notFound("That ticket doesn't exist.");
  await db.supportMessage.create({ data: { id: newId("msg"), ticketId: id, authorId: adminId, isStaff: true, body: input.body } });
  await db.supportTicket.update({ where: { id }, data: { status: input.status } });
  await audit({ actorType: "admin", actorId: adminId, action: "admin.ticket_replied", targetType: "ticket", targetId: id });
  await notify({ userId: ticket.userId, type: "release", title: "Support replied to your ticket", body: ticket.subject, href: `/support/${id}` });
  const user = await db.user.findUnique({ where: { id: ticket.userId }, select: { email: true } });
  if (user) await queueEmail({ userId: ticket.userId, to: user.email, template: "support_reply", subject: `Re: ${ticket.subject}`, body: input.body });
  return adminGetTicket(id);
}

export async function adminSetTicketStatus(adminId: string, id: string, status: "open" | "answered" | "closed") {
  const { count } = await db.supportTicket.updateMany({ where: { id }, data: { status } });
  if (!count) throw Errors.notFound("That ticket doesn't exist.");
  await audit({ actorType: "admin", actorId: adminId, action: "admin.ticket_replied", targetType: "ticket", targetId: id, metadata: { status } });
}
