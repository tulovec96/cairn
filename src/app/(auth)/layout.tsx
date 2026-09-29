import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { Logo } from "@/components/ui/Logo";
import { getPageActor } from "@/server/page-auth";

export default async function AuthLayout({ children }: { children: ReactNode }) {
  const actor = await getPageActor();
  if (actor) redirect("/dashboard");
  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="flex h-14 items-center justify-between px-4 sm:px-6">
        <Link href="/" aria-label="Cairn home" className="text-fg">
          <Logo />
        </Link>
        <ThemeToggle />
      </header>
      <main id="main" tabIndex={-1} className="flex flex-1 items-start justify-center px-4 pt-6 pb-16 outline-none sm:items-center sm:pt-0">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
