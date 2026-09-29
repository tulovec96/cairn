"use client";

import { Check, Minus } from "lucide-react";
import { useState } from "react";
import { PlanCard, type PlanView } from "@/components/billing/PlanCard";
import { ButtonLink } from "@/components/ui/Button";
import { FEATURES, FEATURE_KEYS, LIMITS, LIMIT_KEYS, formatLimit } from "@/config/entitlements";
import { cn } from "@/lib/cn";

interface Props {
  plans: PlanView[];
  signedIn: boolean;
  canRegister: boolean;
  cardPayments: boolean;
}

export function PricingView({ plans, signedIn, canRegister, cardPayments }: Props) {
  const hasYearly = plans.some((p) => p.priceYearlyCents > 0);
  const [interval, setInterval] = useState<"month" | "year">("month");
  const groups = [...new Set(FEATURE_KEYS.map((k) => FEATURES[k].group))];

  const cta = (p: PlanView) => {
    const paid = p.priceMonthlyCents > 0;
    if (signedIn) return <ButtonLink href="/settings/billing" full variant={paid ? "primary" : "secondary"}>{paid ? "Choose in billing" : "See your plan"}</ButtonLink>;
    if (!canRegister) return <ButtonLink href="/login" full>Sign in</ButtonLink>;
    return (
      <ButtonLink href="/register" full variant={paid ? "primary" : "secondary"}>
        {paid ? `Start with ${p.name}` : "Create a free account"}
      </ButtonLink>
    );
  };

  return (
    <div>
      {hasYearly && (
        <div role="group" aria-label="Billing period" className="mb-6 inline-flex rounded-lg border border-line-strong bg-surface p-0.5 text-[13px]">
          {(["month", "year"] as const).map((v) => (
            <button key={v} type="button" aria-pressed={interval === v} onClick={() => setInterval(v)} className={cn("rounded-md px-4 py-1.5 font-medium transition-colors", interval === v ? "bg-accent text-accent-fg" : "text-muted hover:text-fg")}>
              {v === "month" ? "Monthly" : "Yearly"}
            </button>
          ))}
        </div>
      )}
      <div className={cn("grid gap-4", plans.length >= 4 ? "md:grid-cols-2 xl:grid-cols-4" : plans.length === 3 ? "md:grid-cols-3" : "md:grid-cols-2")}>
        {plans.map((p, i) => (
          <PlanCard
            key={p.key}
            plan={p}
            headingLevel={2}
            interval={interval}
            highlight={plans.length > 2 && i === 1}
            action={cta(p)}
            footnote={p.priceMonthlyCents > 0 && !cardPayments ? "On this installation paid plans are assigned by an administrator." : undefined}
          />
        ))}
      </div>

      <div className="mt-14">
        <h2 className="mk-display text-2xl">Compare every limit and feature</h2>
        <div role="region" aria-label="Plan comparison table" tabIndex={0} className="relative mt-5 overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[36rem] text-[13px]">
            <caption className="sr-only">Plan comparison</caption>
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="w-[36%] px-4 py-3 text-left font-medium text-subtle">
                  <span className="sr-only">Limit or feature</span>
                </th>
                {plans.map((p) => (
                  <th key={p.key} scope="col" className="px-3 py-3 text-left font-semibold">
                    {p.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th colSpan={plans.length + 1} scope="colgroup" className="bg-surface-2/60 px-4 py-2 text-left font-mono text-[11px] font-medium tracking-widest text-subtle uppercase">
                  Limits
                </th>
              </tr>
              {LIMIT_KEYS.map((k) => (
                <tr key={k} className="border-t border-line">
                  <th scope="row" className="px-4 py-2.5 text-left font-normal">
                    {LIMITS[k].label}
                    <span className="block text-xs text-subtle">{LIMITS[k].description}</span>
                  </th>
                  {plans.map((p) => (
                    <td key={p.key} className="px-3 py-2.5 font-medium tnum">
                      {formatLimit(k, p.limits[k])}
                    </td>
                  ))}
                </tr>
              ))}
              {groups.map((g) => (
                <FeatureRows key={g} group={g} plans={plans} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function FeatureRows({ group, plans }: { group: string; plans: PlanView[] }) {
  return (
    <>
      <tr>
        <th colSpan={plans.length + 1} scope="colgroup" className="bg-surface-2/60 px-4 py-2 text-left font-mono text-[11px] font-medium tracking-widest text-subtle uppercase">
          {group}
        </th>
      </tr>
      {FEATURE_KEYS.filter((k) => FEATURES[k].group === group).map((k) => (
        <tr key={k} className="border-t border-line">
          <th scope="row" className="px-4 py-2.5 text-left font-normal">
            {FEATURES[k].label}
            <span className="block text-xs text-subtle">{FEATURES[k].description}</span>
          </th>
          {plans.map((p) => (
            <td key={p.key} className="px-3 py-2.5">
              {p.features[k] ? (
                <>
                  <Check className="size-4 text-success" aria-hidden />
                  <span className="sr-only">Included</span>
                </>
              ) : (
                <>
                  <Minus className="size-4 text-subtle" aria-hidden />
                  <span className="sr-only">Not included</span>
                </>
              )}
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
