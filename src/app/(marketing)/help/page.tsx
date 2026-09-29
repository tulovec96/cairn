import type { Metadata } from "next";
import Link from "next/link";
import { MarketingHero } from "@/components/marketing/MarketingShell";
import { HELP_ARTICLES } from "@/lib/help-content";

export const metadata: Metadata = { title: "Help center" };

export default function HelpPage() {
  return (
    <>
      <MarketingHero eyebrow="Help center" title="How to do the things people ask about." lead={<>Short, step-by-step answers. For quick questions try the <Link href="/faq" className="text-accent hover:underline">FAQ</Link>; for anything else, <Link href="/contact" className="text-accent hover:underline">contact us</Link>.</>} />
      <section>
        <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[14rem_1fr]">
          <nav aria-label="Articles" className="lg:sticky lg:top-20 lg:self-start">
            <ul className="flex gap-1 overflow-x-auto lg:flex-col lg:gap-0.5">
              {HELP_ARTICLES.map((a) => (
                <li key={a.id} className="shrink-0">
                  <a href={`#${a.id}`} className="block rounded-md px-3 py-1.5 text-[13px] font-medium text-muted hover:bg-surface-2 hover:text-fg">
                    {a.title}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="space-y-14">
            {HELP_ARTICLES.map((a) => (
              <article key={a.id} id={a.id} className="scroll-mt-20">
                <h2 className="mk-display text-2xl">{a.title}</h2>
                <p className="mt-1.5 text-[14px] text-muted">{a.summary}</p>
                <ol className="mt-5 space-y-3">
                  {a.steps.map((s, i) => (
                    <li key={i} className="flex gap-4 text-[14px] leading-relaxed">
                      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-line-strong font-mono text-xs text-subtle">{i + 1}</span>
                      <span>{s}</span>
                    </li>
                  ))}
                </ol>
                {a.note && <p className="mt-4 rounded-lg border border-line bg-surface-2/60 px-4 py-3 text-[13px] leading-relaxed text-muted">{a.note}</p>}
              </article>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
