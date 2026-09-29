import { z } from "zod";
import type { Changelog, Incident } from "@prisma/client";
import { db } from "../db";
import { Errors } from "../errors";
import { newId } from "../ids";
import { audit } from "./audit";
import { parseJson } from "./serializers";

// ---------------------------------------------------------------------------------------------
// Changelog
// ---------------------------------------------------------------------------------------------

export const CHANGELOG_KINDS = ["feature", "improvement", "fix", "security"] as const;

export const changelogSchema = z.object({
  title: z.string().trim().min(3).max(120),
  body: z.string().trim().min(3).max(8000),
  kind: z.enum(CHANGELOG_KINDS),
  version: z.string().trim().max(30).nullable().optional(),
  publish: z.boolean().default(false),
});

export interface ChangelogDto {
  id: string;
  title: string;
  body: string;
  kind: string;
  version: string | null;
  publishedAt: string | null;
  createdAt: string;
}

const clDto = (c: Changelog): ChangelogDto => ({ id: c.id, title: c.title, body: c.body, kind: c.kind, version: c.version, publishedAt: c.publishedAt?.toISOString() ?? null, createdAt: c.createdAt.toISOString() });

export async function publicChangelog(limit = 100): Promise<ChangelogDto[]> {
  return (await db.changelog.findMany({ where: { publishedAt: { not: null, lte: new Date() } }, orderBy: { publishedAt: "desc" }, take: limit })).map(clDto);
}

export async function adminChangelog(): Promise<ChangelogDto[]> {
  return (await db.changelog.findMany({ orderBy: [{ publishedAt: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }], take: 200 })).map(clDto);
}

export async function createChangelog(adminId: string, input: z.infer<typeof changelogSchema>): Promise<ChangelogDto> {
  const row = await db.changelog.create({ data: { id: newId("chg"), title: input.title, body: input.body, kind: input.kind, version: input.version ?? null, publishedAt: input.publish ? new Date() : null, createdById: adminId } });
  await audit({ actorType: "admin", actorId: adminId, action: "admin.changelog_changed", targetType: "changelog", targetId: row.id, metadata: { created: true, published: input.publish } });
  return clDto(row);
}

export async function updateChangelog(adminId: string, id: string, patch: Partial<z.infer<typeof changelogSchema>>): Promise<ChangelogDto> {
  const existing = await db.changelog.findUnique({ where: { id } });
  if (!existing) throw Errors.notFound("That entry doesn't exist.");
  const row = await db.changelog.update({
    where: { id },
    data: {
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.body !== undefined ? { body: patch.body } : {}),
      ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
      ...(patch.version !== undefined ? { version: patch.version } : {}),
      ...(patch.publish !== undefined ? { publishedAt: patch.publish ? (existing.publishedAt ?? new Date()) : null } : {}),
    },
  });
  await audit({ actorType: "admin", actorId: adminId, action: "admin.changelog_changed", targetType: "changelog", targetId: id });
  return clDto(row);
}

export async function deleteChangelog(adminId: string, id: string): Promise<void> {
  const { count } = await db.changelog.deleteMany({ where: { id } });
  if (!count) throw Errors.notFound("That entry doesn't exist.");
  await audit({ actorType: "admin", actorId: adminId, action: "admin.changelog_changed", targetType: "changelog", targetId: id, metadata: { deleted: true } });
}

// ---------------------------------------------------------------------------------------------
// Status & incidents
// ---------------------------------------------------------------------------------------------

export const SERVICES: Record<string, string> = {
  database: "Database",
  storage: "File storage",
  jobs: "Background processing",
  scanner: "Malware scanning",
};

export const incidentSchema = z.object({
  title: z.string().trim().min(3).max(150),
  body: z.string().trim().min(3).max(4000),
  severity: z.enum(["minor", "major", "critical"]).default("minor"),
  status: z.enum(["investigating", "identified", "monitoring", "resolved"]).default("investigating"),
  services: z.array(z.string().max(30)).max(10).default([]),
});

export interface IncidentDto {
  id: string;
  title: string;
  body: string;
  severity: string;
  status: string;
  services: string[];
  createdAt: string;
  resolvedAt: string | null;
}

const incDto = (i: Incident): IncidentDto => ({ id: i.id, title: i.title, body: i.body, severity: i.severity, status: i.status, services: parseJson<string[]>(i.services, []), createdAt: i.createdAt.toISOString(), resolvedAt: i.resolvedAt?.toISOString() ?? null });

export interface StatusDto {
  overall: "operational" | "degraded" | "outage" | "unknown";
  services: Array<{ key: string; name: string; ok: boolean | null; latencyMs: number | null; checkedAt: string | null; uptime90: number | null; days: Array<{ day: string; ok: number; failed: number }> }>;
  incidents: IncidentDto[];
  recent: IncidentDto[];
}

/** Built only from stored health-check results and incidents an administrator has posted. No check data means "unknown". */
export async function publicStatus(): Promise<StatusDto> {
  const since = new Date(Date.now() - 90 * 86400_000);
  const checks = await db.statusCheck.findMany({ where: { createdAt: { gte: since } }, orderBy: { createdAt: "asc" }, select: { service: true, ok: true, latencyMs: true, createdAt: true }, take: 200_000 });
  const byService = new Map<string, typeof checks>();
  for (const c of checks) byService.set(c.service, [...(byService.get(c.service) ?? []), c]);
  const services = Object.entries(SERVICES)
    .filter(([key]) => byService.has(key) || key !== "scanner")
    .map(([key, name]) => {
      const list = byService.get(key) ?? [];
      const latest = list[list.length - 1];
      const fresh = latest && Date.now() - latest.createdAt.getTime() < 20 * 60_000;
      const perDay = new Map<string, { ok: number; failed: number }>();
      for (const c of list) {
        const day = c.createdAt.toISOString().slice(0, 10);
        const d = perDay.get(day) ?? { ok: 0, failed: 0 };
        if (c.ok) d.ok++;
        else d.failed++;
        perDay.set(day, d);
      }
      const okCount = list.filter((c) => c.ok).length;
      return {
        key,
        name,
        ok: fresh ? latest.ok : null,
        latencyMs: fresh ? latest.latencyMs : null,
        checkedAt: latest?.createdAt.toISOString() ?? null,
        uptime90: list.length ? Math.round((okCount / list.length) * 10000) / 100 : null,
        days: [...perDay.entries()].map(([day, v]) => ({ day, ...v })),
      };
    });
  const open = await db.incident.findMany({ where: { resolvedAt: null }, orderBy: { createdAt: "desc" } });
  const recent = await db.incident.findMany({ where: { resolvedAt: { not: null }, createdAt: { gte: new Date(Date.now() - 30 * 86400_000) } }, orderBy: { createdAt: "desc" }, take: 20 });
  const known = services.filter((s) => s.ok !== null);
  const failing = known.filter((s) => !s.ok).length;
  const critical = open.some((i) => i.severity === "critical");
  const overall: StatusDto["overall"] = !known.length ? "unknown" : failing === known.length || critical ? "outage" : failing > 0 || open.length > 0 ? "degraded" : "operational";
  return { overall, services, incidents: open.map(incDto), recent: recent.map(incDto) };
}

export async function adminIncidents(): Promise<IncidentDto[]> {
  return (await db.incident.findMany({ orderBy: { createdAt: "desc" }, take: 100 })).map(incDto);
}

export async function createIncident(adminId: string, input: z.infer<typeof incidentSchema>): Promise<IncidentDto> {
  const row = await db.incident.create({ data: { id: newId("inc"), title: input.title, body: input.body, severity: input.severity, status: input.status, services: JSON.stringify(input.services), createdById: adminId, resolvedAt: input.status === "resolved" ? new Date() : null } });
  await audit({ actorType: "admin", actorId: adminId, action: "admin.incident_changed", targetType: "incident", targetId: row.id, metadata: { created: true } });
  return incDto(row);
}

export async function updateIncident(adminId: string, id: string, patch: Partial<z.infer<typeof incidentSchema>>): Promise<IncidentDto> {
  const existing = await db.incident.findUnique({ where: { id } });
  if (!existing) throw Errors.notFound("That incident doesn't exist.");
  const row = await db.incident.update({
    where: { id },
    data: {
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.body !== undefined ? { body: patch.body } : {}),
      ...(patch.severity !== undefined ? { severity: patch.severity } : {}),
      ...(patch.services !== undefined ? { services: JSON.stringify(patch.services) } : {}),
      ...(patch.status !== undefined ? { status: patch.status, resolvedAt: patch.status === "resolved" ? (existing.resolvedAt ?? new Date()) : null } : {}),
    },
  });
  await audit({ actorType: "admin", actorId: adminId, action: "admin.incident_changed", targetType: "incident", targetId: id });
  return incDto(row);
}
