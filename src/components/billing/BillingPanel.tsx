"use client";

import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/Confirm";
import { Badge, Card, CardHeader, ErrorNotice, Skeleton } from "@/components/ui/Feedback";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/api-client";
import { formatDate, formatMoney } from "@/lib/format";
import { useResource } from "@/lib/useResource";
import type { BillingState } from "@/server/services/billing";
import { PlanCard, type PlanView } from "./PlanCard";

interface PlansPayload {
  plans: PlanView[];
}

const EVENT_LABELS: Record<string, string> = {
  plan_assigned: "Plan changed",
  plan_changed: "Plan changed",
  subscribed: "Subscribed",
  payment_succeeded: "Payment received",
  payment_failed: "Payment failed",
  cancel_scheduled: "Cancellation scheduled",
  canceled: "Canceled",
  resumed: "Resumed",
};

export function BillingPanel() {
  const toast = useToast();
  const confirm = useConfirm();
  const [interval, setInterval] = useState<"month" | "year">("month");
  const [busy, setBusy] = useState<string | null>(null);
  const state = useResource<BillingState>("billing", (s) => api<BillingState>("/api/v1/billing", { signal: s }));
  const plans = useResource<PlansPayload>("plans", (s) => api<PlansPayload>("/api/v1/plans", { signal: s }));

  const post = async (action: string, body: Record<string, unknown> = {}) => {
    setBusy(action);
    try {
      return await api<{ url?: string; endsAt?: string | null }>("/api/v1/billing", { method: "POST", body: { action, ...body } });
    } catch (err) {
      toast.error("That didn't work", errorMessage(err));
      return null;
    } finally {
      setBusy(null);
    }
  };

  if (state.error || plans.error) return <ErrorNotice>{state.error ?? plans.error}</ErrorNotice>;
  if (!state.data || !plans.data) {
    return (
      <div className="grid gap-4 md:grid-cols-3" aria-busy="true">
        <Skeleton className="h-96" />
        <Skeleton className="h-96" />
        <Skeleton className="h-96" />
      </div>
    );
  }
  const b = state.data;
  const sub = b.subscription;
  const stripe = b.provider === "stripe";
  const hasYearly = b.plans.some((p) => p.priceYearlyCents > 0);

  const checkout = async (plan: string) => {
    const res = await post("checkout", { plan, interval });
    if (res?.url) window.location.assign(res.url);
  };
  const portal = async () => {
    const res = await post("portal");
    if (res?.url) window.location.assign(res.url);
  };
  const cancel = async () => {
    if (!(await confirm({ title: "Cancel your subscription?", description: "You keep everything until the end of the period you've paid for, then move to the free plan. Nothing is deleted, but you won't be able to add files if you're over the free limits.", confirmLabel: "Cancel subscription", tone: "danger" }))) return;
    const res = await post("cancel");
    if (res) {
      toast.success("Cancellation scheduled", res.endsAt ? `Your plan ends ${formatDate(res.endsAt)}.` : undefined);
      state.reload();
    }
  };
  const resume = async () => {
    if (await post("resume")) {
      toast.success("Subscription resumed");
      state.reload();
    }
  };

  return (
    <div className="space-y-6">
      {!b.canManage && <ErrorNotice tone="info">Only owners and admins can change this organization&apos;s plan.</ErrorNotice>}
      {stripe && !b.providerConfigured && <ErrorNotice tone="warning">Card payments are switched on but not fully configured. Contact your administrator.</ErrorNotice>}

      <Card>
        <CardHeader title="Current plan" />
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 p-4">
          <div>
            <p className="text-lg font-semibold">{b.plan.name}</p>
            <p className="text-[13px] text-muted">
              {b.plan.priceMonthlyCents > 0 ? `${formatMoney(b.plan.priceMonthlyCents, b.plan.currency)} / month` : "Free"}
              {sub?.currentPeriodEnd && ` · ${sub.cancelAtPeriodEnd ? "ends" : "renews"} ${formatDate(sub.currentPeriodEnd)}`}
            </p>
          </div>
          {sub && (
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={sub.cancelAtPeriodEnd ? "warning" : "success"}>{sub.cancelAtPeriodEnd ? "Cancels at period end" : sub.status}</Badge>
              <Badge>{sub.managedBy === "stripe" ? "Billed by card" : "Set by an administrator"}</Badge>
            </div>
          )}
          {b.canManage && (
            <div className="ml-auto flex flex-wrap gap-2">
              {stripe && sub?.managedBy === "stripe" && (
                <Button onClick={portal} loading={busy === "portal"} icon={<ExternalLink className="size-4" aria-hidden />}>
                  Payment method & invoices
                </Button>
              )}
              {sub && (sub.cancelAtPeriodEnd ? (
                <Button onClick={resume} loading={busy === "resume"}>Keep my plan</Button>
              ) : (
                <Button variant="danger-outline" onClick={cancel} loading={busy === "cancel"}>Cancel plan</Button>
              ))}
            </div>
          )}
        </div>
      </Card>

      {!stripe && (
        <ErrorNotice tone="info">
          Card payments aren&apos;t enabled on this installation, so plans are assigned by an administrator. To change yours,{" "}
          <Link href="/support" className="font-medium underline underline-offset-2">
            contact support
          </Link>
          .
        </ErrorNotice>
      )}

      <section aria-labelledby="plans-h">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 id="plans-h" className="text-sm font-semibold">
            Plans
          </h2>
          {hasYearly && (
            <div role="group" aria-label="Billing period" className="inline-flex rounded-lg border border-line bg-surface p-0.5 text-[13px]">
              {(["month", "year"] as const).map((v) => (
                <button key={v} type="button" aria-pressed={interval === v} onClick={() => setInterval(v)} className={interval === v ? "rounded-md bg-accent-soft px-3 py-1 font-medium text-accent" : "rounded-md px-3 py-1 text-muted hover:text-fg"}>
                  {v === "month" ? "Monthly" : "Yearly"}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {plans.data.plans.map((p) => {
            const meta = b.plans.find((x) => x.key === p.key);
            const current = !!meta?.current;
            return (
              <PlanCard
                key={p.key}
                plan={p}
                interval={interval}
                current={current}
                action={
                  current ? null : stripe && meta?.purchasable && b.canManage ? (
                    <Button variant="primary" full loading={busy === "checkout"} onClick={() => checkout(p.key)}>
                      Choose {p.name}
                    </Button>
                  ) : (
                    <p className="text-xs text-subtle">{stripe ? "Not available for card checkout." : "Assigned by an administrator."}</p>
                  )
                }
              />
            );
          })}
        </div>
      </section>

      <Card>
        <CardHeader title="Billing history" />
        {b.history.length === 0 ? (
          <p className="p-4 text-[13px] text-muted">No billing activity yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {b.history.map((h) => (
              <li key={h.id} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
                <span className="font-medium">{EVENT_LABELS[h.type] ?? h.type.replaceAll("_", " ")}</span>
                {h.amountCents != null && h.currency && <span className="text-muted tnum">{formatMoney(h.amountCents, h.currency)}</span>}
                <time className="ml-auto text-xs text-subtle tnum" dateTime={h.createdAt}>
                  {formatDate(h.createdAt)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
