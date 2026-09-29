import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { requirePageUser } from "@/server/page-auth";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const actor = await requirePageUser();
  return <AppShell actor={actor}>{children}</AppShell>;
}
