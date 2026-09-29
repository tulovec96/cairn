import { route } from "@/server/http";
import { listPlans } from "@/server/services/entitlements";
import { FEATURES, LIMITS } from "@/config/entitlements";

export const dynamic = "force-dynamic";

/** Public plan catalogue: prices, feature flags and limits, straight from the plan records. */
export const GET = route(async () => {
  const plans = await listPlans({ publicOnly: true });
  return {
    plans: plans.map((p) => ({ key: p.key, name: p.name, description: p.description, priceMonthlyCents: p.priceMonthlyCents, priceYearlyCents: p.priceYearlyCents, currency: p.currency, features: p.features, limits: p.limits })),
    features: FEATURES,
    limits: LIMITS,
  };
});