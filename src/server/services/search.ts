import type { Prisma } from "@prisma/client";
import { db } from "../db";
import type { Filter, NumericFilter, ParsedQuery } from "@/lib/search";
import { scopeWhere, type Scope } from "./actor";

export const activeShareWhere = (): Prisma.ShareLinkWhereInput => ({
  revokedAt: null,
  OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
});

function numeric<T extends number | bigint | Date>(f: NumericFilter, conv: (n: number) => T): Record<string, T> {
  switch (f.op) {
    case "between":
      return { gte: conv(f.min), lte: conv(f.max) };
    case ">":
      return { gt: conv(f.value) };
    case ">=":
      return { gte: conv(f.value) };
    case "<":
      return { lt: conv(f.value) };
    case "<=":
      return { lte: conv(f.value) };
    default:
      return { equals: conv(f.value) };
  }
}

async function folderIdsMatching(scope: Scope, name: string): Promise<string[]> {
  const roots = await db.folder.findMany({ where: { ...scopeWhere(scope), deletedAt: null, nameKey: { contains: name } }, select: { id: true }, take: 200 });
  const ids = new Set(roots.map((r) => r.id));
  let frontier = [...ids];
  for (let depth = 0; frontier.length && depth < 32 && ids.size < 5000; depth++) {
    const kids = await db.folder.findMany({ where: { ...scopeWhere(scope), deletedAt: null, parentId: { in: frontier } }, select: { id: true } });
    frontier = kids.map((k) => k.id).filter((id) => !ids.has(id));
    for (const id of frontier) ids.add(id);
  }
  return [...ids];
}

/** Compiles a parsed search query into a Prisma filter. Returns AND-able conditions. */
export async function compileFileFilters(q: ParsedQuery, ctx: { scope: Scope }): Promise<Prisma.FileWhereInput[]> {
  const and: Prisma.FileWhereInput[] = [];
  const not = (negate: boolean, cond: Prisma.FileWhereInput): Prisma.FileWhereInput => (negate ? { NOT: cond } : cond);

  for (const w of q.words) and.push(not(w.negate, { nameKey: { contains: w.text } }));

  for (const f of q.filters as Filter[]) {
    switch (f.kind) {
      case "type":
        and.push(not(f.negate, { category: f.value }));
        break;
      case "ext":
        and.push(not(f.negate, { extension: f.value }));
        break;
      case "mime":
        and.push(not(f.negate, f.prefix ? { mime: { startsWith: f.value } } : { mime: f.value }));
        break;
      case "folder": {
        const ids = await folderIdsMatching(ctx.scope, f.value);
        // Files at the top level have a NULL folder, and SQL's NOT (NULL IN …) matches nothing, so negation is spelled out.
        and.push(f.negate ? { OR: [{ folderId: null }, { folderId: { notIn: ids } }] } : { folderId: { in: ids.length ? ids : ["__none__"] } });
        break;
      }
      case "tag":
        and.push(f.negate ? { tags: { none: { tag: { nameKey: f.value } } } } : { tags: { some: { tag: { nameKey: f.value } } } });
        break;
      case "owner":
        and.push(not(f.negate, f.value === "me" ? { ownerId: ctx.scope.userId } : { owner: { email: { contains: f.value } } }));
        break;
      case "size":
        and.push({ size: numeric(f.filter, (n) => BigInt(Math.max(0, Math.round(n)))) });
        break;
      case "created":
        and.push({ createdAt: numeric(f.filter, (n) => new Date(n)) });
        break;
      case "modified":
        and.push({ updatedAt: numeric(f.filter, (n) => new Date(n)) });
        break;
      case "is":
        if (f.value === "favorite") and.push(f.negate ? { favorites: { none: { userId: ctx.scope.userId } } } : { favorites: { some: { userId: ctx.scope.userId } } });
        else if (f.value === "shared") and.push(f.negate ? { shares: { none: activeShareWhere() } } : { shares: { some: activeShareWhere() } });
        else if (f.value === "private") and.push(f.negate ? { shares: { some: activeShareWhere() } } : { shares: { none: activeShareWhere() } });
        else if (f.value === "archived") and.push(f.negate ? { archivedAt: null } : { archivedAt: { not: null } });
        break;
      case "status":
        and.push(not(f.negate, { status: f.value }));
        break;
      case "has":
        if (f.value === "versions") and.push(f.negate ? { versions: { none: {} } } : { versions: { some: {} } });
        else if (f.value === "comments") and.push(f.negate ? { comments: { none: { deletedAt: null } } } : { comments: { some: { deletedAt: null } } });
        else if (f.value === "description") and.push(f.negate ? { description: "" } : { NOT: { description: "" } });
        else if (f.value === "tags") and.push(f.negate ? { tags: { none: {} } } : { tags: { some: {} } });
        break;
    }
  }
  return and;
}

/** True when the query itself asks about archived files, so the default "hide archived" rule is skipped. */
export function mentionsArchived(q: ParsedQuery): boolean {
  return q.filters.some((f) => f.kind === "is" && f.value === "archived" && !f.negate);
}
