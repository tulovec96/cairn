import type { Metadata } from "next";
import { MarketingHero } from "@/components/marketing/MarketingShell";
import { Badge } from "@/components/ui/Feedback";
import { formatDate } from "@/lib/format";
import { publicChangelog } from "@/server/services/content";

export const metadata: Metadata = { title: "Changelog" };
export const dynamic = "force-dynamic";

const TONE = { feature: "accent", improvement: "success", fix: "neutral", security: "warning" } as const;

export default async function ChangelogPage() {
  const entries = await publicChangelog();
  return (
    <>
      <MarketingHero eyebrow="Changelog" title="What changed, in the order it changed." lead="Written by the people who run this installation. Nothing appears here until they publish it." />
      <section>
        <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
          {entries.length === 0 ? (
            <p className="rounded-lg border border-dashed border-line-strong p-8 text-center text-[14px] text-muted">No entries have been published yet.</p>
          ) : (
            <ol className="relative space-y-12 border-l border-line pl-8">
              {entries.map((e) => (
                <li key={e.id} className="relative">
                  <span className="absolute top-2 -left-[37px] size-2.5 rounded-full border-2 border-bg bg-accent" aria-hidden />
                  <div className="flex flex-wrap items-center gap-2 text-xs text-subtle">
                    <time dateTime={e.publishedAt ?? undefined} className="font-mono">
                      {formatDate(e.publishedAt, "UTC")}
                    </time>
                    {e.version && <span className="font-mono">v{e.version.replace(/^v/i, "")}</span>}
                    <Badge tone={TONE[e.kind as keyof typeof TONE] ?? "neutral"}>{e.kind}</Badge>
                  </div>
                  <h2 className="mk-display mt-2 text-2xl">{e.title}</h2>
                  <div className="mt-3 space-y-3 text-[14px] leading-relaxed text-muted">
                    {e.body.split(/\n{2,}/).map((p, i) => (
                      <p key={i} className="whitespace-pre-line">
                        {p}
                      </p>
                    ))}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>
    </>
  );
}
