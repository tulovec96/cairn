import type { Metadata } from "next";
import Link from "next/link";
import { MarketingHero } from "@/components/marketing/MarketingShell";
import { PricingView } from "@/components/marketing/PricingView";
import { getPageActor } from "@/server/page-auth";
import { activeProvider, stripeConfigured } from "@/server/services/billing";
import { buildPublicConfig } from "@/server/services/config";
import { listPlans } from "@/server/services/entitlements";

export const metadata: Metadata = { title: "Pricing" };
export const dynamic = "force-dynamic";

export default async function PricingPage() {
  const [plans, actor, config, provider] = await Promise.all([listPlans({ publicOnly: true }), getPageActor(), buildPublicConfig(null), activeProvider()]);
  const cardPayments = provider === "stripe" && stripeConfigured();
  return (
    <>
      <MarketingHero
        eyebrow="Pricing"
        title="Plans with the numbers on the front."
        lead={
          cardPayments
            ? "Prices, limits and features below are read from the same plan records the servers enforce. What you see is what you get."
            : "Prices, limits and features below are read from the same plan records the servers enforce. On this installation plans are assigned by an administrator, so there's no checkout: pick what you need and ask."
        }
      />
      <section>
        <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6">
          {plans.length === 0 ? (
            <p className="text-muted">No plans are published yet.</p>
          ) : (
            <PricingView
              plans={plans.map((p) => ({ key: p.key, name: p.name, description: p.description, priceMonthlyCents: p.priceMonthlyCents, priceYearlyCents: p.priceYearlyCents, currency: p.currency, features: p.features, limits: p.limits }))}
              signedIn={!!actor}
              canRegister={config.registrationEnabled}
              cardPayments={cardPayments}
            />
          )}
          <ul className="mt-10 max-w-2xl space-y-2 text-[13px] leading-relaxed text-muted">
            <li>Every limit above is enforced by the server, not just displayed. When you hit one you get a clear message, never a silent failure.</li>
            <li>Downgrades are refused if you&apos;re using more than the new plan allows. Nothing is ever deleted to make room.</li>
            <li>
              Questions about limits or a plan that doesn&apos;t exist yet? <Link href="/contact" className="text-accent underline underline-offset-2">Get in touch</Link>.
            </li>
          </ul>
        </div>
      </section>
    </>
  );
}
