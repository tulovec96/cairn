import type { ReactNode } from "react";
import { PublicShell } from "@/components/layout/PublicShell";
import { getPageActor } from "@/server/page-auth";

export default async function PublicLayout({ children }: { children: ReactNode }) {
  const actor = await getPageActor();
  return <PublicShell actor={actor}>{children}</PublicShell>;
}
