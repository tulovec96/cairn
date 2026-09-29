import type { Metadata } from "next";
import Link from "next/link";
import { MarketingHero, Section } from "@/components/marketing/MarketingShell";
import { getSettings } from "@/server/settings";

export const metadata: Metadata = { title: "Security" };
export const dynamic = "force-dynamic";

const AREAS: Array<{ title: string; items: Array<[string, string]> }> = [
  {
    title: "Accounts and sessions",
    items: [
      ["Passwords", "Hashed with scrypt and a per-user salt. We never store or log the password, and a leaked database can't be replayed as passwords."],
      ["Sessions", "A random token in an HttpOnly, SameSite cookie. Only its hash is stored, so a copy of the database can't be used to sign in. Sessions are listed in your settings and can be revoked one by one."],
      ["Two-factor authentication", "TOTP with one-time backup codes (stored hashed). A code can't be replayed inside its window. Turning it off or regenerating codes needs your password and a code."],
      ["Sign-in protection", "Attempts are rate-limited per account and per address. Failed and successful sign-ins appear in your security history, and password changes sign out your other browsers."],
      ["Recovery", "One-time, expiring links. If no email provider is configured, only an administrator can hand one out."],
    ],
  },
  {
    title: "Files",
    items: [
      ["Integrity", "SHA-256 is verified between your browser and the server, then kept on the file record. A corrupted or tampered upload is rejected."],
      ["Scanning and quarantine", "Uploads are scanned before they can be downloaded. A finding blocks the file, revokes its links and puts it in a review queue for an administrator. Scanning uses ClamAV when the operator connects it; without it, only file-type rules apply, and the health page says which."],
      ["Safe delivery", "Downloads are served as attachments with nosniff. Previews use types the server decided on, never the type the uploader claimed, and the content is never rendered as HTML."],
      ["Viewers", "SVG is sanitized, Markdown is sanitized, code and text are escaped. Nothing from a file runs in your session."],
      ["Deletion", "Trashed files are recoverable for the length your plan allows, then removed from storage. Deleting your account removes your files, links and keys."],
    ],
  },
  {
    title: "Sharing",
    items: [
      ["Unguessable links", "Share tokens are long random values. Links can carry passwords (hashed), expiry, limits, view-only mode and IP allow-lists, and can be revoked instantly."],
      ["No accounts for outsiders", "Public links and file requests are not accounts. An uploader through a request only holds a per-upload key that can move bytes for that one upload."],
      ["Privacy-first analytics", "Share analytics are counters by day plus the referring site. No IP addresses, no cookies, no fingerprinting."],
    ],
  },
  {
    title: "The API and webhooks",
    items: [
      ["Scoped keys", "Keys are shown once and stored as hashes. Each has only the scopes you gave it and can expire. Keys can't create or list other keys."],
      ["Webhook signatures", "Deliveries carry a timestamped HMAC-SHA256 signature so receivers can reject forgeries and old replays. Secrets are encrypted at rest and shown once."],
      ["SSRF protection", "Webhook targets and URL imports are validated, and the address is checked again at connection time, so DNS tricks can't reach private networks."],
      ["Rate limits", "Every API key is limited per minute according to its plan, and abuse of public endpoints is limited per address."],
    ],
  },
  {
    title: "The application",
    items: [
      ["Browser protections", "A strict per-request Content-Security-Policy with nonces, frame protection, no-referrer, a locked-down permissions policy and HSTS over HTTPS. State-changing requests from browsers must come from the same origin."],
      ["Permissions on the server", "Every action is authorised on the server against your role and plan. Hiding a button is a courtesy, never the protection."],
      ["Audit trail", "Security-relevant actions, including everything administrators do, are recorded and can be reviewed."],
      ["No third parties", "No analytics, ads or external scripts. Nothing on a page phones home to anyone else."],
    ],
  },
];

const LIMITS = [
  "Files are not end-to-end encrypted. The server has to read a file to scan, preview and thumbnail it.",
  "Cairn itself does not encrypt file contents at rest. Use encryption on the disk or storage bucket that holds them (S3-compatible stores offer server-side encryption).",
  "Database backups contain accounts and records but not file contents. Back up your storage separately.",
  "Passkeys and single sign-on are not available yet.",
  "Malware scanning is only as good as the scanner you connect. It reduces risk; it doesn't remove it.",
];

export default async function SecurityPage() {
  const settings = await getSettings();
  const email = settings.support.contactEmail;
  return (
    <>
      <MarketingHero eyebrow="Security" title="How Cairn protects your files, and where it doesn't." lead="A list of the measures that exist in the code you're using today, followed by the things it does not do. If a claim isn't here, don't assume it." />
      {AREAS.map((a, i) => (
        <Section key={a.title} title={a.title} className={i % 2 ? "bg-surface-2/40" : ""}>
          <dl className="divide-y divide-line border-y border-line">
            {a.items.map(([k, v]) => (
              <div key={k} className="grid gap-1 py-4 md:grid-cols-[13rem_1fr] md:gap-10">
                <dt className="text-[14px] font-semibold">{k}</dt>
                <dd className="max-w-3xl text-[14px] leading-relaxed text-muted">{v}</dd>
              </div>
            ))}
          </dl>
        </Section>
      ))}
      <Section eyebrow="Honest limits" title="What Cairn does not do" lead="Security claims are only useful next to their limits.">
        <ul className="max-w-3xl space-y-3 text-[14px] leading-relaxed">
          {LIMITS.map((t) => (
            <li key={t} className="flex gap-3">
              <span className="mt-2 size-1.5 shrink-0 rounded-full bg-warning" aria-hidden />
              <span className="text-muted">{t}</span>
            </li>
          ))}
        </ul>
      </Section>
      <Section eyebrow="Report a problem" title="Found a vulnerability?">
        <p className="max-w-2xl text-[14px] leading-relaxed text-muted">
          {email ? (
            <>
              Email <a href={`mailto:${email}`} className="font-medium text-accent hover:underline">{email}</a> with what you found and how to reproduce it. Please give us a reasonable chance to fix it before you publish, and don&apos;t access data that isn&apos;t yours.
            </>
          ) : (
            <>
              The operator of this installation hasn&apos;t published a security contact yet. Until they do, open a ticket from a signed-in account under{" "}
              <Link href="/support" className="font-medium text-accent hover:underline">
                Support
              </Link>{" "}
              and choose “Something is broken”.
            </>
          )}
        </p>
      </Section>
    </>
  );
}
