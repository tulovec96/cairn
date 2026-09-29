import { Menu } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { ButtonLink } from "@/components/ui/Button";
import { Logo } from "@/components/ui/Logo";
import type { Actor } from "@/server/services/actor";

export const MARKETING_NAV = [
  { href: "/features", label: "Features" },
  { href: "/pricing", label: "Pricing" },
  { href: "/security", label: "Security" },
  { href: "/developers", label: "Developers" },
  { href: "/help", label: "Help" },
] as const;

const FOOTER = [
  {
    title: "Product",
    links: [
      { href: "/features", label: "Features" },
      { href: "/pricing", label: "Pricing" },
      { href: "/security", label: "Security" },
      { href: "/changelog", label: "Changelog" },
    ],
  },
  {
    title: "Developers",
    links: [
      { href: "/developers", label: "Overview" },
      { href: "/developer/docs", label: "API reference" },
      { href: "/developer/docs#webhooks", label: "Webhooks" },
      { href: "/status", label: "Status" },
    ],
  },
  {
    title: "Support",
    links: [
      { href: "/help", label: "Help center" },
      { href: "/faq", label: "FAQ" },
      { href: "/contact", label: "Contact" },
    ],
  },
  {
    title: "Account",
    links: [
      { href: "/login", label: "Sign in" },
      { href: "/register", label: "Create an account" },
      { href: "/forgot-password", label: "Reset password" },
    ],
  },
] as const;

export function MarketingShell({ actor, children }: { actor: Actor | null; children: ReactNode }) {
  return (
    <div className="mk flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b border-line bg-bg/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-6 px-4 sm:px-6">
          <Link href="/" aria-label="Cairn home" className="text-fg">
            <Logo className="text-[17px]" />
          </Link>
          <nav aria-label="Main" className="hidden items-center gap-0.5 text-[13px] font-medium md:flex">
            {MARKETING_NAV.map((l) => (
              <Link key={l.href} href={l.href} className="rounded-md px-3 py-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-fg">
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1.5">
            <ThemeToggle />
            {actor ? (
              <ButtonLink href="/dashboard" variant="primary" size="sm">
                Open dashboard
              </ButtonLink>
            ) : (
              <>
                <ButtonLink href="/login" variant="ghost" size="sm" className="hidden sm:inline-flex">
                  Sign in
                </ButtonLink>
                <ButtonLink href="/register" variant="primary" size="sm">
                  Get started
                </ButtonLink>
              </>
            )}
            {/* Works without JavaScript: a disclosure, not a script-driven drawer. */}
            <details className="group relative md:hidden">
              <summary aria-label="Menu" className="flex size-9 cursor-pointer list-none items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg [&::-webkit-details-marker]:hidden">
                <Menu className="size-5" aria-hidden />
              </summary>
              <nav aria-label="Mobile" className="absolute top-11 right-0 w-56 rounded-lg border border-line bg-surface p-1.5 shadow-[var(--shadow-pop)]">
                {MARKETING_NAV.map((l) => (
                  <Link key={l.href} href={l.href} className="block rounded-md px-3 py-2 text-[13px] font-medium hover:bg-surface-2">
                    {l.label}
                  </Link>
                ))}
                <Link href="/changelog" className="block rounded-md px-3 py-2 text-[13px] font-medium hover:bg-surface-2">
                  Changelog
                </Link>
                {!actor && (
                  <Link href="/login" className="block rounded-md px-3 py-2 text-[13px] font-medium hover:bg-surface-2">
                    Sign in
                  </Link>
                )}
              </nav>
            </details>
          </div>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="flex-1 outline-none">
        {children}
      </main>
      <footer className="border-t border-line bg-surface-2/50">
        <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_repeat(4,1fr)]">
          <div className="max-w-xs">
            <Logo />
            <p className="mt-3 text-[13px] leading-relaxed text-muted">File hosting with accounts you control, links you can revoke, and an API that does what the docs say.</p>
          </div>
          {FOOTER.map((col) => (
            <nav key={col.title} aria-label={col.title}>
              <h2 className="text-xs font-semibold tracking-wide text-subtle uppercase">{col.title}</h2>
              <ul className="mt-3 space-y-2 text-[13px]">
                {col.links.map((l) => (
                  <li key={l.href}>
                    <Link href={l.href} className="text-muted hover:text-fg hover:underline">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="border-t border-line">
          <p className="mx-auto max-w-6xl px-4 py-4 text-xs text-subtle sm:px-6">No trackers, no advertising, no third-party scripts. The only cookies are your sign-in session and your theme choice.</p>
        </div>
      </footer>
    </div>
  );
}

/** Consistent page heading for marketing sub-pages. */
export function MarketingHero({ eyebrow, title, lead, children }: { eyebrow: string; title: string; lead?: ReactNode; children?: ReactNode }) {
  return (
    <section className="border-b border-line">
      <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
        <p className="font-mono text-xs tracking-widest text-accent uppercase">{eyebrow}</p>
        <h1 className="mk-display mt-3 max-w-3xl text-4xl leading-[1.08] sm:text-5xl">{title}</h1>
        {lead && <p className="mt-5 max-w-2xl text-[16px] leading-relaxed text-muted">{lead}</p>}
        {children && <div className="mt-8">{children}</div>}
      </div>
    </section>
  );
}

export function Section({ id, eyebrow, title, lead, children, className }: { id?: string; eyebrow?: string; title: string; lead?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section id={id} className={`border-b border-line ${className ?? ""}`}>
      <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 sm:py-16">
        <div className="max-w-2xl">
          {eyebrow && <p className="font-mono text-xs tracking-widest text-subtle uppercase">{eyebrow}</p>}
          <h2 className="mk-display mt-2 text-3xl leading-tight sm:text-[34px]">{title}</h2>
          {lead && <p className="mt-3 text-[15px] leading-relaxed text-muted">{lead}</p>}
        </div>
        <div className="mt-9">{children}</div>
      </div>
    </section>
  );
}
