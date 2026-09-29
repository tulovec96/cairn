import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { PublicShell } from "@/components/layout/PublicShell";
import { getPageActor } from "@/server/page-auth";

/** Pages that make sense for both audiences: signed-in users get the app shell, everyone else the public frame. */
export default async function AdaptiveLayout({ children }: { children: ReactNode }) {
  const actor = await getPageActor();
  if (actor) return <AppShell actor={actor}>{children}</AppShell>;
  return <PublicShell actor={actor}>{children}</PublicShell>;
}
