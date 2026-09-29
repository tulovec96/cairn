import { Suspense, type ReactNode } from "react";
import { db } from "@/server/db";
import { usageFor, entitlementsForActor } from "@/server/services/limits";
import { getSidebarCollapsed } from "@/server/page-auth";
import type { Actor } from "@/server/services/actor";
import { serializeUser } from "@/server/services/serializers";
import type { OrgRoleName } from "@/lib/types";
import { AccountProvider, type AccountValue } from "./AccountContext";
import { CommandPalette } from "./CommandPalette";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { VerifyEmailBanner } from "./VerifyEmailBanner";

/**
 * Authenticated application frame: persistent left sidebar on desktop, drawer on small screens, and a
 * top bar with search, notifications and the account menu. Individual pages only render their content.
 */
export async function AppShell({ actor, children }: { actor: Actor; children: ReactNode }) {
  const [collapsed, usage, ent, memberships] = await Promise.all([
    getSidebarCollapsed(),
    usageFor(actor),
    entitlementsForActor(actor),
    db.organizationMember.findMany({ where: { userId: actor.user.id }, include: { org: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } }),
  ]);
  const isAdmin = actor.user.role === "admin";
  const sidebarUsage = { usedBytes: usage.usedBytes, quotaBytes: usage.quotaBytes, percent: usage.percent };
  const account: AccountValue = {
    user: serializeUser(actor.user),
    workspace: { orgId: actor.workspace.orgId, role: actor.workspace.role, name: actor.workspace.orgName ?? null },
    orgs: memberships.map((m) => ({ id: m.org.id, name: m.org.name, role: m.role as OrgRoleName })),
    plan: { key: ent.planKey, name: ent.planName, features: ent.features, limits: ent.limits },
  };
  return (
    <AccountProvider value={account}>
      <div className="flex h-dvh overflow-hidden bg-bg">
        <Sidebar isAdmin={isAdmin} initialCollapsed={collapsed} usage={sidebarUsage} />
        <div className="flex min-w-0 flex-1 flex-col">
          <Suspense fallback={<div className="h-14 shrink-0 border-b border-line bg-surface" />}>
            <TopBar name={actor.user.displayName} email={actor.user.email} avatarUrl={account.user.avatarUrl} isAdmin={isAdmin} usage={sidebarUsage} />
          </Suspense>
          {!actor.user.emailVerifiedAt && <VerifyEmailBanner />}
          <main id="main" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto outline-none">
            {children}
          </main>
        </div>
      </div>
      <CommandPalette isAdmin={isAdmin} />
    </AccountProvider>
  );
}

export function PageContainer({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return <div className={wide ? "mx-auto w-full max-w-7xl px-4 py-6 sm:px-6" : "mx-auto w-full max-w-5xl px-4 py-6 sm:px-6"}>{children}</div>;
}