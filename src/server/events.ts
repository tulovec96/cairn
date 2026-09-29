import { AsyncLocalStorage } from "node:async_hooks";
import { ACTIVITY_EVENTS, type EventType } from "@/config/events";
import { db } from "./db";
import { newId } from "./ids";

export interface AppEvent {
  type: EventType;
  /** User id (personal files) or organization id: whose history and webhooks this belongs to. */
  workspaceId: string;
  /** The account that owns the affected content. Webhooks and automations belong to this account. */
  ownerId: string;
  orgId?: string | null;
  actorId?: string | null;
  actorLabel?: string | null;
  fileId?: string | null;
  folderId?: string | null;
  targetName?: string;
  data?: Record<string, unknown>;
}

/**
 * The internal event bus. Anything that happens to content is announced here once; listeners turn it
 * into activity history, webhook deliveries and automation runs. A failing listener never breaks the
 * operation that emitted the event.
 */
const automationContext = new AsyncLocalStorage<true>();

/** Runs `fn` as an automation action: every event it emits is marked so automations can't trigger themselves. */
export function runAsAutomation<T>(fn: () => Promise<T>): Promise<T> {
  return automationContext.run(true, fn);
}

export async function emit(source: AppEvent): Promise<void> {
  const event: AppEvent = automationContext.getStore() ? { ...source, data: { ...source.data, viaAutomation: true } } : source;
  const eventId = newId("evt");
  const guard = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (err) {
      console.error(`[events] ${name} listener failed for ${event.type}:`, (err as Error).message);
    }
  };

  await guard("activity", async () => {
    if (!ACTIVITY_EVENTS.has(event.type)) return;
    await db.activityEvent.create({
      data: {
        id: newId("act"),
        workspaceId: event.workspaceId,
        actorId: event.actorId ?? null,
        actorLabel: event.actorLabel?.slice(0, 120) ?? null,
        action: event.type.split(".")[1],
        fileId: event.fileId ?? null,
        folderId: event.folderId ?? null,
        targetName: (event.targetName ?? "").slice(0, 300),
        metadata: event.data ? JSON.stringify(event.data).slice(0, 4000) : "{}",
      },
    });
  });
  await guard("webhooks", async () => (await import("./services/webhooks")).enqueueForEvent(event, eventId));
  await guard("automations", async () => (await import("./services/automations")).enqueueForEvent(event));
}
