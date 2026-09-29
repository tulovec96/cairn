"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { FeatureKey, PlanFeatures, PlanLimits } from "@/config/entitlements";
import type { OrgRoleName, UserDto } from "@/lib/types";

export interface OrgLite {
  id: string;
  name: string;
  role: OrgRoleName;
}

export interface AccountValue {
  user: UserDto;
  workspace: { orgId: string | null; role: OrgRoleName | null; name: string | null };
  orgs: OrgLite[];
  plan: { key: string; name: string; features: PlanFeatures; limits: PlanLimits };
}

const Ctx = createContext<AccountValue | null>(null);

export function AccountProvider({ value, children }: { value: AccountValue; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAccount(): AccountValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAccount must be used inside the app shell");
  return v;
}

/** Whether the current workspace's plan includes a feature. The server enforces this too; this only shapes the UI. */
export function useHasFeature(feature: FeatureKey): boolean {
  return useAccount().plan.features[feature];
}

const RANK: Record<OrgRoleName, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };

/** Mirrors the server's role matrix (services/permissions.ts) so buttons the role can't use are hidden. */
export function useCan(action: "read" | "comment" | "write" | "delete" | "share" | "manage"): boolean {
  const { workspace } = useAccount();
  if (!workspace.orgId || !workspace.role) return true;
  const level = RANK[workspace.role];
  if (action === "read" || action === "comment") return true;
  if (action === "manage") return level >= 2;
  return level >= 1;
}