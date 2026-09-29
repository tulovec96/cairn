"use client";

import { Sparkles } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { FEATURES, type FeatureKey } from "@/config/entitlements";
import { useAccount } from "@/components/layout/AccountContext";
import { cn } from "@/lib/cn";

/**
 * A quiet, honest prompt shown where a feature isn't part of the current plan. It names the feature and points at the
 * plans page. The server enforces the same rule, so hiding the feature here is a courtesy, never the protection.
 */
export function UpgradeNotice({ feature, className, compact }: { feature: FeatureKey; className?: string; compact?: boolean }) {
  const { plan, workspace } = useAccount();
  const def = FEATURES[feature];
  return (
    <div className={cn("flex items-start gap-3 rounded-lg border border-line bg-surface-2 text-[13px]", compact ? "p-3" : "p-4", className)}>
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
        <Sparkles className="size-4" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="font-medium text-fg">{def.label} isn&apos;t included in {workspace.orgId ? "this organization's" : "your"} {plan.name} plan.</p>
        {!compact && <p className="mt-0.5 text-muted">{def.description}</p>}
        <Link href="/settings/billing" className="mt-1.5 inline-block font-medium text-accent hover:underline">
          See what each plan includes
        </Link>
      </div>
    </div>
  );
}

/** Renders children when the plan has the feature, otherwise the upgrade notice. */
export function FeatureGate({ feature, children, className }: { feature: FeatureKey; children: ReactNode; className?: string }) {
  const { plan } = useAccount();
  if (plan.features[feature]) return <>{children}</>;
  return <UpgradeNotice feature={feature} className={className} />;
}
