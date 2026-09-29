import type { Metadata } from "next";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { MarketingHero } from "@/components/marketing/MarketingShell";
import { FAQS } from "@/lib/help-content";

export const metadata: Metadata = { title: "FAQ" };

export default function FaqPage() {
  return (
    <>
      <MarketingHero eyebrow="FAQ" title="Straight answers to common questions." />
      <section>
        <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
          <div className="divide-y divide-line border-y border-line">
            {FAQS.map((f) => (
              <details key={f.q} className="group py-1">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-[15px] font-medium [&::-webkit-details-marker]:hidden">
                  {f.q}
                  <ChevronDown className="size-4 shrink-0 text-subtle transition-transform group-open:rotate-180" aria-hidden />
                </summary>
                <p className="pr-8 pb-4 text-[14px] leading-relaxed text-muted">{f.a}</p>
              </details>
            ))}
          </div>
          <p className="mt-8 text-[14px] text-muted">
            Didn&apos;t find it? Try the{" "}
            <Link href="/help" className="text-accent hover:underline">
              help center
            </Link>{" "}
            or{" "}
            <Link href="/contact" className="text-accent hover:underline">
              contact us
            </Link>
            .
          </p>
        </div>
      </section>
    </>
  );
}
