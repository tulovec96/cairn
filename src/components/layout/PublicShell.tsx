import Link from "next/link";
import type { ReactNode } from "react";
import { ButtonLink } from "@/components/ui/Button";
import { Logo } from "@/components/ui/Logo";
import type { Actor } from "@/server/services/actor";
import { ThemeToggle } from "./ThemeToggle";

/** Simple frame for signed-out visitors and public pages. No account navigation. */
export function PublicShell({ actor, children, width = "max-w-5xl" }: { actor: Actor | null; children: ReactNode; width?: string }) {
  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-4 px-4 sm:px-6">
          <Link href="/" aria-label="Cairn home" className="text-fg">
            <Logo />
          </Link>
          <nav aria-label="Main" className="flex items-center gap-1 text-[13px] font-medium">
            <Link href="/" className="rounded-md px-2.5 py-1.5 text-muted hover:bg-surface-2 hover:text-fg">
              Home
            </Link>
            <Link href="/developer/docs" className="hidden rounded-md px-2.5 py-1.5 text-muted hover:bg-surface-2 hover:text-fg sm:block">
              API
            </Link>
          </nav>
          <div className="ml-auto flex items-center gap-1.5">
            <ThemeToggle />
            {actor ? (
              <ButtonLink href="/dashboard" variant="primary" size="sm">
                Open dashboard
              </ButtonLink>
            ) : (
              <>
                <ButtonLink href="/login" variant="ghost" size="sm">
                  Sign in
                </ButtonLink>
                <ButtonLink href="/register" variant="primary" size="sm">
                  Sign up
                </ButtonLink>
              </>
            )}
          </div>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="flex-1 outline-none">
        <div className={`mx-auto w-full px-4 py-8 sm:px-6 sm:py-12 ${width}`}>{children}</div>
      </main>
      <footer className="border-t border-line py-5 text-center text-xs text-subtle">
        Cairn · File hosting with accounts, sharing and an API. <Link href="/developer/docs" className="underline-offset-2 hover:underline">API docs</Link>
      </footer>
    </div>
  );
}
