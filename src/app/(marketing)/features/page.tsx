import type { Metadata } from "next";
import { MarketingHero, Section } from "@/components/marketing/MarketingShell";
import { ButtonLink } from "@/components/ui/Button";
import type { FeatureKey } from "@/config/entitlements";
import { listPlans } from "@/server/services/entitlements";

export const metadata: Metadata = { title: "Features" };
export const dynamic = "force-dynamic";

interface Item {
  title: string;
  body: string;
  /** Set when a plan can switch this off; the badge is computed from the real plan records. */
  gate?: FeatureKey;
}

const GROUPS: Array<{ id: string; eyebrow: string; title: string; lead: string; items: Item[] }> = [
  {
    id: "upload",
    eyebrow: "Storage and uploads",
    title: "Uploads that survive real networks",
    lead: "Big files, flaky Wi-Fi, closed laptops. The upload engine is built for all three.",
    items: [
      { title: "Chunked, resumable uploads", body: "Files are split into chunks and sent in parallel. Close the tab and reopen it: interrupted uploads are listed and can be resumed by picking the same file." },
      { title: "End-to-end integrity", body: "SHA-256 is computed in your browser and checked by the server. A mismatch is rejected. The checksum stays on the file so anyone can verify a download." },
      { title: "Folders and drag-and-drop", body: "Drop a folder and its structure is recreated. Drag files onto folders or breadcrumbs to move them." },
      { title: "A persistent queue", body: "Pause, resume, cancel and retry. Statuses are honest: hashing, uploading, verifying, scanning, complete, quarantined or failed." },
      { title: "Import from a URL", body: "Fetch a file from a public web address straight into storage. Private and internal networks are refused.", gate: "urlImport" },
      { title: "Versions", body: "Upload over an existing file to keep the old one as a version, then compare and restore.", gate: "fileVersioning" },
    ],
  },
  {
    id: "organize",
    eyebrow: "Organize and find",
    title: "Find the file, not the folder it might be in",
    lead: "A file manager with five views, real search and no dark corners.",
    items: [
      { title: "List, compact, grid, large and gallery", body: "Switch views without losing your place. Long lists are virtualized so a folder with thousands of files stays fast." },
      { title: "Search with operators", body: "Combine words with type:, ext:, size:, folder:, tag:, modified:, created:, is: and has:. Save searches and pin them to the sidebar." },
      { title: "Tags, notes and metadata", body: "Tag files, add a description and a colour label, and attach your own key/value fields." },
      { title: "Favorites, recent and archive", body: "Star what you use, see what you touched, and archive what you want out of the way without deleting it." },
      { title: "Bulk actions and batch rename", body: "Move, copy, tag, archive, share or trash a selection. Rename many files with a pattern and preview every result first." },
      { title: "Duplicate finder", body: "Groups of files with identical content, with the space you could reclaim. Nothing is ever deleted automatically." },
    ],
  },
  {
    id: "preview",
    eyebrow: "Preview",
    title: "Open it here instead of downloading it first",
    lead: "Viewers are built to be safe with files from strangers.",
    items: [
      { title: "Images, video and audio", body: "Zoom and pan images, seek video, and step through a media library with a lightbox and a real slideshow timer." },
      { title: "Documents and text", body: "PDF, Markdown (sanitized), CSV tables and syntax-highlighted code, with line numbers and wrapping." },
      { title: "Thumbnails and metadata", body: "Thumbnails for images, and dimensions and orientation from image files. Where ffmpeg is installed on the server you also get video poster frames and durations." },
      { title: "No active content", body: "SVG is sanitized, HTML is shown as text, and nothing from a file is ever executed in your session." },
    ],
  },
  {
    id: "share",
    eyebrow: "Sharing",
    title: "Links with the controls you would want",
    lead: "Every link is a record you can inspect, change or kill.",
    items: [
      { title: "Passwords and expiry", body: "Protect a link with a password and give it an end date. Expired and revoked links stop working immediately." },
      { title: "Limits", body: "Cap the number of downloads or views a link allows.", gate: "shareLimits" },
      { title: "View-only and IP allow-lists", body: "Let people look without downloading, or restrict a link to specific addresses.", gate: "sharePermissions" },
      { title: "Share analytics", body: "Views and downloads per day, and where visitors came from. Counts only: no cookies, no fingerprinting.", gate: "shareAnalytics" },
      { title: "Your name on it", body: "Add a title, a message and an accent colour to share pages and upload portals.", gate: "customBranding" },
      { title: "Embeds", body: "Embed an image, video, audio file or PDF from a share link in another page.", gate: "embeds" },
      { title: "ZIP downloads", body: "Download a folder or a selection as a ZIP that is built on demand and cleaned up afterwards." },
    ],
  },
  {
    id: "collaborate",
    eyebrow: "Collaboration",
    title: "Working with other people",
    lead: "Accounts for your team, links for everyone else.",
    items: [
      { title: "File requests", body: "Ask anyone for files with a link that has a destination folder, size and count limits, allowed extensions, an expiry and an optional password. The sender never gets an account.", gate: "fileRequests" },
      { title: "Upload portals", body: "A reusable, branded page for ongoing intake, like client documents or submissions.", gate: "portals" },
      { title: "Share a folder with people", body: "Give other accounts view-only access to a folder and everything inside it. They browse, preview and download; only you can change it, and you can end access at any time." },
      { title: "Organizations", body: "Shared workspaces with owner, admin, member and viewer roles, pooled storage and their own plan.", gate: "teams" },
      { title: "Comments and activity", body: "Discuss a file in place and see who did what and when.", gate: "comments" },
    ],
  },
  {
    id: "automate",
    eyebrow: "Automation and integration",
    title: "Let the routine take care of itself",
    lead: "Rules and webhooks run on the same event stream, and both are inspectable.",
    items: [
      { title: "Automations", body: "When a file arrives, is moved, renamed or tagged: check name, type, size or tags, then move, copy, tag, rename, archive, share or notify. Every run is logged.", gate: "automations" },
      { title: "Webhooks", body: "Signed HTTP calls for uploads, downloads, shares, requests and more. Failures retry with backoff and you can replay any delivery.", gate: "webhooks" },
      { title: "REST API", body: "Everything the interface does, with scoped API keys, per-plan rate limits and a usage view. Reference documentation is public.", gate: "api" },
      { title: "Storage and transfer analytics", body: "Where your space goes, what grew, what nobody has opened in months, and how much you transferred.", gate: "advancedAnalytics" },
    ],
  },
  {
    id: "account",
    eyebrow: "Account and safety",
    title: "Controls for you, and for whoever runs the installation",
    lead: "",
    items: [
      { title: "Two-factor authentication", body: "TOTP apps with one-time backup codes, plus a login history and the ability to sign out other devices." },
      { title: "Your data, portable", body: "Export your profile, structure, metadata and files as a ZIP, or delete your account and everything in it." },
      { title: "Light, dark or system", body: "Full keyboard navigation, a command palette, reduced-motion support and layouts that work on a phone." },
      { title: "An administrator panel", body: "Users, plans, quarantine review, abuse reports, jobs, health, backups, feature flags and an audit log." },
    ],
  },
];

export default async function FeaturesPage() {
  const plans = await listPlans({ publicOnly: true });
  const availability = (k: FeatureKey): string => {
    const has = plans.filter((p) => p.features[k]);
    if (has.length === 0) return "Not in a public plan";
    if (has.length === plans.length) return "Every plan";
    return `From ${has[0].name}`;
  };
  return (
    <>
      <MarketingHero eyebrow="Features" title="Everything the product does, and where the plan lines are." lead="Nothing here is a roadmap item. If a feature depends on your plan, its badge tells you which one, read live from the plan records." />
      <div className="border-b border-line bg-surface-2/40">
        <nav aria-label="Feature groups" className="mx-auto flex w-full max-w-6xl gap-1 overflow-x-auto px-4 py-2 text-[13px] font-medium sm:px-6">
          {GROUPS.map((g) => (
            <a key={g.id} href={`#${g.id}`} className="shrink-0 rounded-md px-3 py-1.5 text-muted hover:bg-surface-2 hover:text-fg">
              {g.eyebrow}
            </a>
          ))}
        </nav>
      </div>
      {GROUPS.map((g, gi) => (
        <Section key={g.id} id={g.id} eyebrow={g.eyebrow} title={g.title} lead={g.lead || undefined} className={gi % 2 ? "bg-surface-2/40" : ""}>
          <dl className="grid gap-x-10 gap-y-8 md:grid-cols-2">
            {g.items.map((it) => (
              <div key={it.title}>
                <dt className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">
                  {it.title}
                  {it.gate && <span className="rounded-full border border-line-strong px-2 py-0.5 font-mono text-[10px] font-normal tracking-wide text-subtle uppercase">{availability(it.gate)}</span>}
                </dt>
                <dd className="mt-1.5 text-[14px] leading-relaxed text-muted">{it.body}</dd>
              </div>
            ))}
          </dl>
        </Section>
      ))}
      <section>
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-14 sm:px-6">
          <h2 className="mk-display text-2xl">Want the limits in numbers?</h2>
          <div className="flex gap-3">
            <ButtonLink href="/pricing" variant="primary">
              Compare plans
            </ButtonLink>
            <ButtonLink href="/security">How it&apos;s secured</ButtonLink>
          </div>
        </div>
      </section>
    </>
  );
}
