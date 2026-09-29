import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check, CheckCircle2, FileArchive, FileImage, FileText, FolderOpen, LockKeyhole, Play, ShieldCheck, Sparkles, UploadCloud, Users } from "lucide-react";
import { CairnStack } from "@/components/marketing/CairnStack";
import { Section } from "@/components/marketing/MarketingShell";
import { ButtonLink } from "@/components/ui/Button";
import { getPageActor } from "@/server/page-auth";
import { buildPublicConfig } from "@/server/services/config";

export const metadata: Metadata = { title: { absolute: "Cairn — file hosting you can trust with real work" } };

const STEPS = [
  { n: "01", title: "Upload", body: "Files travel in chunks that resume after any interruption. Drag in a whole folder; the structure comes with it." },
  { n: "02", title: "Verify", body: "Your browser computes a SHA-256 checksum before sending and the server confirms it after. The digest is shown on every file." },
  { n: "03", title: "Scan", body: "Every upload is checked before anyone can download it. Blocked types and malware go to a quarantine queue, not to your links." },
  { n: "04", title: "Share", body: "Send a link, or ask someone to send you files with no account needed on their side. You decide how long it works." },
] as const;

const LEDGER = [
  ["Find anything", "Search with operators such as type:image size:>50MB tag:invoice, save the searches you reuse, and see duplicates without anything being deleted for you."],
  ["Preview in place", "Images, video, audio, PDF, Markdown, CSV and syntax-highlighted code open in the browser. Nothing is executed and nothing is injected into the page."],
  ["Keep every version", "Upload a new version over a file and restore an older one whenever you need to. Retention follows your plan."],
  ["Work with a team", "Organizations with owner, admin, member and viewer roles, shared storage, comments and an activity history."],
  ["Automate the routine", "Rules that tag, move, rename, archive or share files when they arrive. Every run is logged."],
  ["Build on it", "A documented REST API with scoped keys, and webhooks signed with HMAC that you can replay from a delivery log."],
] as const;

export default async function HomePage() {
  const [actor, config] = await Promise.all([getPageActor(), buildPublicConfig(null)]);
  const canRegister = config.registrationEnabled;
  return (
    <>
      <section className="relative overflow-hidden border-b border-line">
        <div className="mk-paper-grid pointer-events-none absolute inset-0 opacity-60" aria-hidden />
        <div className="relative mx-auto grid w-full max-w-6xl gap-12 px-4 py-14 sm:px-6 sm:py-24 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          <div>
            <p className="font-mono text-xs tracking-widest text-accent uppercase">File hosting with accounts</p>
            <h1 className="mk-display mt-4 text-[40px] leading-[1.04] sm:text-6xl">
              Files that stay where
              <br />
              you put them.
            </h1>
            <p className="mt-6 max-w-xl text-[17px] leading-relaxed text-muted">
              Cairn stores your files behind an account, checks them on the way in, and shares them through links you can shape and revoke. No guests, no ads, no tracking, and nothing on this page is made up.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              {actor ? (
                <ButtonLink href="/dashboard" variant="primary" size="lg">
                  Open your dashboard
                </ButtonLink>
              ) : canRegister ? (
                <ButtonLink href="/register" variant="primary" size="lg">
                  Create an account
                </ButtonLink>
              ) : (
                <ButtonLink href="/login" variant="primary" size="lg">
                  Sign in
                </ButtonLink>
              )}
              <ButtonLink href="/features" size="lg" icon={<ArrowRight className="size-4" aria-hidden />}>
                See what&apos;s inside
              </ButtonLink>
            </div>
            {!actor && !canRegister && <p className="mt-3 text-[13px] text-subtle">New registrations are closed on this installation.</p>}
          </div>
          <div className="rounded-2xl border border-line bg-surface/80 p-5 shadow-[0_1px_0_rgb(0_0_0/0.04)] sm:p-7">
            <p className="mb-5 font-mono text-[11px] tracking-widest text-subtle uppercase">What happens to a file</p>
            <CairnStack />
          </div>
        </div>
      </section>

      <section className="mk-spotlight border-b border-line">
        <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-16 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:items-center lg:py-24">
          <div className="cairn-rise">
            <p className="font-mono text-xs tracking-widest text-accent uppercase">A calmer control center</p>
            <h2 className="mk-display mt-3 text-4xl leading-[1.03] sm:text-5xl">Your files, with a point of view.</h2>
            <p className="mt-5 max-w-lg text-[16px] leading-7 text-muted">Cairn turns the mess between upload and handoff into a clear, searchable trail. Everything important is visible, reversible, and yours.</p>
            <div className="mt-7 flex flex-wrap gap-3 text-[13px] text-muted">
              <span className="inline-flex items-center gap-2"><CheckCircle2 className="size-4 text-accent" aria-hidden /> Resumable by default</span>
              <span className="inline-flex items-center gap-2"><CheckCircle2 className="size-4 text-accent" aria-hidden /> Share with guardrails</span>
            </div>
          </div>
          <div className="mk-product-window cairn-rise" style={{ animationDelay: "100ms" }}>
            <div className="flex items-center gap-2 border-b border-line px-4 py-3"><span className="size-2 rounded-full bg-danger/70" /><span className="size-2 rounded-full bg-warning/70" /><span className="size-2 rounded-full bg-success/70" /><span className="ml-auto rounded-full bg-accent-soft px-2 py-1 font-mono text-[10px] text-accent">LIVE LIBRARY</span></div>
            <div className="grid gap-4 p-4 sm:grid-cols-[0.8fr_1.2fr] sm:p-6">
              <div className="rounded-xl bg-surface-2 p-4"><p className="font-mono text-[10px] tracking-widest text-subtle uppercase">Workspace</p><p className="mt-4 text-sm font-semibold">Northstar / 2026</p><div className="mt-5 flex flex-col gap-2 text-xs text-muted"><span className="rounded-lg bg-accent-soft px-3 py-2 text-accent">All files</span><span className="px-3 py-2">Shared with me</span><span className="px-3 py-2">Recent</span></div></div>
              <div><div className="flex items-center justify-between"><p className="text-sm font-semibold">Recent files</p><span className="text-xs text-subtle">Updated just now</span></div><div className="mt-4 flex flex-col gap-2">{[["Brand direction.pdf", "2.4 MB", FileText], ["Launch assets", "Folder", FolderOpen], ["Product tour.mp4", "84.1 MB", FileImage]].map(([name, meta, Icon]) => { const ItemIcon = Icon as typeof FileText; return <div key={name as string} className="flex items-center gap-3 rounded-xl border border-line bg-surface p-3 transition-transform hover:-translate-y-0.5"><div className="flex size-9 items-center justify-center rounded-lg bg-accent-soft text-accent"><ItemIcon className="size-4" aria-hidden /></div><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium">{name as string}</p><p className="mt-0.5 text-[11px] text-subtle">{meta as string}</p></div><ArrowRight className="size-3.5 text-subtle" aria-hidden /></div> })}</div></div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-line bg-surface-2/40">
        <div className="mx-auto grid w-full max-w-6xl gap-3 px-4 py-5 sm:grid-cols-3 sm:px-6">
          {[{ icon: ShieldCheck, title: "Verified on the way in", body: "Checksums and scanning" }, { icon: LockKeyhole, title: "Private until you decide", body: "Revocable, expiring links" }, { icon: Users, title: "Ready for real teams", body: "Roles, requests, history" }].map(({ icon: Icon, title, body }) => <div key={title} className="flex items-center gap-3 rounded-xl border border-line bg-surface/70 px-4 py-3"><Icon className="size-5 shrink-0 text-accent" aria-hidden /><div><p className="text-xs font-semibold">{title}</p><p className="mt-0.5 text-[11px] text-muted">{body}</p></div></div>)}
        </div>
      </section>

      <Section eyebrow="The route" title="From your disk to someone else's, without guesswork" lead="Four steps, each visible in the product. You can see where any file is at any moment.">
        <ol className="grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s) => (
            <li key={s.n}>
              <div className="mk-rule mb-4" aria-hidden />
              <p className="font-mono text-xs text-accent">{s.n}</p>
              <h3 className="mk-display mt-1 text-xl">{s.title}</h3>
              <p className="mt-2 text-[13px] leading-relaxed text-muted">{s.body}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section eyebrow="Inside" title="A file manager that keeps up with how you work" className="bg-surface-2/40">
        <dl className="divide-y divide-line border-y border-line">
          {LEDGER.map(([k, v]) => (
            <div key={k} className="grid gap-1 py-5 md:grid-cols-[14rem_1fr] md:gap-10">
              <dt className="mk-display text-lg">{k}</dt>
              <dd className="max-w-2xl text-[14px] leading-relaxed text-muted">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-6 text-[13px]">
          <Link href="/features" className="font-medium text-accent hover:underline">
            Every feature, in detail →
          </Link>
        </p>
      </Section>

      <Section eyebrow="Designed for momentum" title="Small details that make a big difference" lead="The features you notice after the first week are the ones that make you stay.">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="mk-feature-card md:col-span-2"><div className="flex size-10 items-center justify-center rounded-xl bg-accent-soft text-accent"><Sparkles className="size-5" aria-hidden /></div><h3 className="mk-display mt-6 text-2xl">Search that feels like memory.</h3><p className="mt-2 max-w-lg text-sm leading-6 text-muted">Use plain language or operators. Save a search once and let it become a living view of your library.</p><div className="mt-6 flex flex-wrap gap-2 font-mono text-[11px] text-accent"><span className="rounded-full border border-accent-line bg-accent-soft px-3 py-1">type:image</span><span className="rounded-full border border-accent-line bg-accent-soft px-3 py-1">size:&gt;50MB</span><span className="rounded-full border border-accent-line bg-accent-soft px-3 py-1">tag:launch</span></div></div>
          <div className="mk-feature-card"><div className="flex size-10 items-center justify-center rounded-xl bg-accent-soft text-accent"><UploadCloud className="size-5" aria-hidden /></div><h3 className="mk-display mt-6 text-2xl">Drop a whole folder.</h3><p className="mt-2 text-sm leading-6 text-muted">Resumable uploads keep moving even when your connection does not.</p><div className="mt-7 h-2 overflow-hidden rounded-full bg-surface-3"><div className="h-full w-3/4 rounded-full bg-accent" /></div><p className="mt-2 text-right font-mono text-[11px] text-subtle">3 of 4 files ready</p></div>
          <div className="mk-feature-card"><div className="flex size-10 items-center justify-center rounded-xl bg-accent-soft text-accent"><Play className="size-5" aria-hidden /></div><h3 className="mk-display mt-6 text-2xl">Preview without detours.</h3><p className="mt-2 text-sm leading-6 text-muted">Open media, documents, code and data in place. Keep your context while you decide.</p></div>
          <div className="mk-feature-card md:col-span-2"><div className="flex items-center gap-3"><div className="flex size-10 items-center justify-center rounded-xl bg-accent-soft text-accent"><FileArchive className="size-5" aria-hidden /></div><div><h3 className="mk-display text-2xl">A complete paper trail.</h3><p className="mt-1 text-sm text-muted">Versions, comments, activity and signed webhooks make handoffs easy to trust.</p></div></div><div className="mt-6 grid grid-cols-3 gap-2 text-center text-[11px] text-muted"><div className="rounded-lg border border-line bg-surface p-3"><b className="block text-lg text-fg">24</b>versions</div><div className="rounded-lg border border-line bg-surface p-3"><b className="block text-lg text-fg">100%</b>traceable</div><div className="rounded-lg border border-line bg-surface p-3"><b className="block text-lg text-fg">0</b>guesswork</div></div></div>
        </div>
      </Section>

      <Section eyebrow="Two ways in" title="Accounts for people who store. Links and requests for people who don't.">
        <div className="grid gap-6 md:grid-cols-2">
          <div className="rounded-xl border border-line bg-surface p-6">
            <h3 className="mk-display text-xl">Everything is uploaded from an account</h3>
            <p className="mt-2 text-[14px] leading-relaxed text-muted">There are no anonymous uploads and no guest accounts. Every stored file has an owner who is accountable for it, which is what makes limits, scanning and takedowns meaningful.</p>
          </div>
          <div className="rounded-xl border border-line bg-surface p-6">
            <h3 className="mk-display text-xl">Requests let anyone send you files</h3>
            <p className="mt-2 text-[14px] leading-relaxed text-muted">A file request is a link with rules: a folder, a size cap, an expiry, maybe a password. The person on the other end never gets an account, and can only add files. They can&apos;t see anything of yours.</p>
          </div>
        </div>
      </Section>

      <Section eyebrow="Straight answers" title="What we won&apos;t do" className="bg-surface-2/40">
        <ul className="grid gap-x-10 gap-y-4 text-[14px] sm:grid-cols-2">
          {[
            "Show numbers that aren't real. Every chart and counter comes from your own records.",
            "Track you across the web. No analytics scripts, no advertising, no third-party embeds.",
            "Delete files without asking. Duplicates are shown to you, never removed automatically.",
            "Hide limits. Your plan's storage, file size and rate limits are on the pricing page and in your settings.",
            "Fake a checkout. If card payments aren't enabled on an installation, plans are assigned by an administrator and the product says so.",
            "Call something secure without saying how. Read the security page for the details, including what we don't do.",
          ].map((t) => (
            <li key={t} className="flex gap-3 leading-relaxed">
              <span className="mt-2 size-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
              <span className="text-muted">{t}</span>
            </li>
          ))}
        </ul>
      </Section>

      <section>
        <div className="mx-auto flex w-full max-w-6xl flex-col items-start gap-6 px-4 py-16 sm:px-6 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="mk-display text-3xl">Start with a free account.</h2>
            <p className="mt-2 max-w-lg text-[14px] text-muted">See the limits on the pricing page first. Upgrade only if you outgrow them.</p>
          </div>
          <div className="flex gap-3">
            {actor ? (
              <ButtonLink href="/dashboard" variant="primary" size="lg">
                Open dashboard
              </ButtonLink>
            ) : canRegister ? (
              <ButtonLink href="/register" variant="primary" size="lg">
                Create an account
              </ButtonLink>
            ) : null}
            <ButtonLink href="/pricing" size="lg">
              See pricing
            </ButtonLink>
          </div>
        </div>
      </section>
    </>
  );
}
