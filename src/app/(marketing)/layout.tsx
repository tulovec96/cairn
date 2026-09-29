import type { ReactNode } from "react";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import { getPageActor } from "@/server/page-auth";

export default async function MarketingLayout({ children }: { children: ReactNode }) {
  const actor = await getPageActor();
  return <MarketingShell actor={actor}>{children}</MarketingShell>;
}
