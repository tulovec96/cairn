import { Check, Minus } from "lucide-react";
import type { ReactNode } from "react";
import { FEATURES, LIMITS, formatLimit, type FeatureKey, type LimitKey, type PlanFeatures, type PlanLimits } from "@/config/entitlements";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/format";

export interface PlanView {
  key: string;
  name: string;
  description: string;
  priceMonthlyCents: number;
  priceYearlyCents: number;
  currency: string;
  features: PlanFeatures;
  limits: PlanLimits;
}

const PRICED_LIMITS = (Object.keys(LIMITS) as LimitKey[]).filter((k) => "pricing" in LIMITS[k] && LIMITS[k].pricing);

export function priceLabel(plan: Pick<PlanView, "priceMonthlyCents" | "priceYearlyCents" | "currency">, interval: "month" | "year") {
  const cents = interval === "year" ? plan.priceYearlyCents : plan.priceMonthlyCents;
  if (cents <= 0) return { amount: "Free", per: "" };
  return { amount: formatMoney(interval === "year" ? Math.round(cents / 12) : cents, plan.currency), per: interval === "year" ? "/ month, billed yearly" : "/ month" };
}

/** One plan, drawn from the plan record itself. Everything shown here is enforced by the server. */
export function PlanCard({ plan, interval, current, highlight, action, footnote, headingLevel = 3 }: { plan: PlanView; interval: "month" | "year"; current?: boolean; highlight?: boolean; action?: ReactNode; footnote?: ReactNode; headingLevel?: 2 | 3 }) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const price = priceLabel(plan, interval);
  const included = (Object.keys(FEATURES) as FeatureKey[]).filter((k) => plan.features[k]);
  return (
    <section aria-label={`${plan.name} plan`} className={cn("flex flex-col rounded-xl border bg-surface p-5", highlight || current ? "border-accent ring-1 ring-accent/40" : "border-line")}>
      <header>
        <Heading className="flex items-center gap-2 text-base font-semibold">
          {plan.name}
          {current && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">Current plan</span>}
        </Heading>
        <p className="mt-1 min-h-10 text-[13px] text-muted">{plan.description}</p>
        <p className="mt-3 flex items-baseline gap-1.5">
          <span className="text-3xl font-semibold tracking-tight tnum">{price.amount}</span>
          {price.per && <span className="text-xs text-subtle">{price.per}</span>}
        </p>
      </header>
      {action && <div className="mt-4">{action}</div>}
      <dl className="mt-5 space-y-1.5 border-t border-line pt-4 text-[13px]">
        {PRICED_LIMITS.map((k) => (
          <div key={k} className="flex justify-between gap-3">
            <dt className="text-muted">{LIMITS[k].label}</dt>
            <dd className="font-medium tnum">{formatLimit(k, plan.limits[k])}</dd>
          </div>
        ))}
      </dl>
      <ul className="mt-4 space-y-1.5 border-t border-line pt-4 text-[13px]">
        {included.length === 0 && (
          <li className="flex items-center gap-2 text-subtle">
            <Minus className="size-3.5" aria-hidden /> Core file hosting only
          </li>
        )}
        {included.map((k) => (
          <li key={k} className="flex items-start gap-2">
            <Check className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden />
            <span>{FEATURES[k].label}</span>
          </li>
        ))}
      </ul>
      {footnote && <div className="mt-4 text-xs text-subtle">{footnote}</div>}
    </section>
  );
}
