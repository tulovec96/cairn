import type { Metadata } from "next";
import Link from "next/link";
import { LifeBuoy, Mail } from "lucide-react";
import { MarketingHero } from "@/components/marketing/MarketingShell";
import { ButtonLink } from "@/components/ui/Button";
import { getPageActor } from "@/server/page-auth";
import { getSettings } from "@/server/settings";

export const metadata: Metadata = { title: "Contact" };
export const dynamic = "force-dynamic";

export default async function ContactPage() {
  const [actor, settings] = await Promise.all([getPageActor(), getSettings()]);
  const email = settings.support.contactEmail;
  return (
    <>
      <MarketingHero eyebrow="Contact" title="Talk to a person." lead="Tickets go to the people who run this installation. Include what you were doing and what you expected; screenshots of error messages help." />
      <section>
        <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-12 sm:px-6 md:grid-cols-2">
          <div className="rounded-xl border border-line bg-surface p-6">
            <LifeBuoy className="size-5 text-accent" aria-hidden />
            <h2 className="mk-display mt-3 text-xl">Open a support ticket</h2>
            <p className="mt-2 text-[14px] leading-relaxed text-muted">The best way to reach us: the conversation stays attached to your account, and replies show up in the app and your notifications.</p>
            <div className="mt-5">
              {actor ? (
                <ButtonLink href="/support" variant="primary">
                  Go to Support
                </ButtonLink>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <ButtonLink href="/login" variant="primary">
                    Sign in to open a ticket
                  </ButtonLink>
                  <ButtonLink href="/register">Create an account</ButtonLink>
                </div>
              )}
            </div>
          </div>
          <div className="rounded-xl border border-line bg-surface p-6">
            <Mail className="size-5 text-accent" aria-hidden />
            <h2 className="mk-display mt-3 text-xl">Email</h2>
            {email ? (
              <>
                <p className="mt-2 text-[14px] leading-relaxed text-muted">For anything you can&apos;t do while signed in, such as a locked-out account or a report about a link.</p>
                <a href={`mailto:${email}`} className="mt-5 inline-block text-[15px] font-medium text-accent hover:underline">
                  {email}
                </a>
              </>
            ) : (
              <p className="mt-2 text-[14px] leading-relaxed text-muted">The operator hasn&apos;t published a contact address on this installation, so tickets are the way in. If you&apos;re locked out of your account, use{" "}
                <Link href="/forgot-password" className="text-accent hover:underline">
                  password reset
                </Link>
                .</p>
            )}
          </div>
        </div>
        <div className="mx-auto w-full max-w-6xl px-4 pb-16 text-[13px] text-muted sm:px-6">
          Reporting a file on a public link? Use the “Report” button on that page. It goes straight to the abuse review queue.
        </div>
      </section>
    </>
  );
}
