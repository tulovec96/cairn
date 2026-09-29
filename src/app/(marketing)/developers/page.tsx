import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock } from "@/components/api/CodeBlock";
import { MarketingHero, Section } from "@/components/marketing/MarketingShell";
import { ButtonLink } from "@/components/ui/Button";
import { EVENTS, EVENT_TYPES } from "@/config/events";
import { formatLimit } from "@/config/entitlements";
import { buildSections, SCOPE_DOCS } from "@/lib/api-docs";
import { env } from "@/server/env";
import { listPlans } from "@/server/services/entitlements";

export const metadata: Metadata = { title: "Developers" };
export const dynamic = "force-dynamic";

const VERIFY = `import { createHmac, timingSafeEqual } from "node:crypto";

// header: X-Cairn-Signature: t=1735689600,v1=5257a869e7ec…
export function verify(rawBody, header, secret, toleranceSec = 300) {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=")));
  const age = Math.abs(Date.now() / 1000 - Number(parts.t));
  if (!parts.t || !parts.v1 || age > toleranceSec) return false;

  const expected = createHmac("sha256", secret).update(\`\${parts.t}.\${rawBody}\`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(parts.v1);
  return a.length === b.length && timingSafeEqual(a, b);
}`;

export default async function DevelopersPage() {
  const base = env.appUrl;
  const [plans] = await Promise.all([listPlans({ publicOnly: true })]);
  const sections = buildSections(base);
  const endpointCount = sections.reduce((n, s) => n + s.endpoints.length, 0);
  return (
    <>
      <MarketingHero
        eyebrow="Developers"
        title="An API that matches the interface, and docs that match the API."
        lead={`${endpointCount} documented endpoints. Anything you can do in the app, you can do over HTTP, with keys you scope, limits you can see and webhooks you can verify.`}
      >
        <div className="flex flex-wrap gap-3">
          <ButtonLink href="/developer/docs" variant="primary" size="lg">
            Read the reference
          </ButtonLink>
          <ButtonLink href="/register" size="lg">
            Get an API key
          </ButtonLink>
        </div>
      </MarketingHero>

      <Section eyebrow="Quick start" title="Upload, list, download" lead="Create a key under Developer → API keys, then:">
        <div className="grid gap-4 lg:grid-cols-3">
          <CodeBlock
            label="Upload"
            code={`curl -H "Authorization: Bearer $CAIRN_KEY" \\
     -F "file=@photo.jpg" \\
     ${base}/api/v1/files`}
          />
          <CodeBlock
            label="List newest first"
            code={`curl -H "Authorization: Bearer $CAIRN_KEY" \\
     "${base}/api/v1/files?sort=created&order=desc"`}
          />
          <CodeBlock
            label="Download, resumable"
            code={`curl -L -O -J -C - \\
     -H "Authorization: Bearer $CAIRN_KEY" \\
     ${base}/api/v1/files/FILE_ID/download`}
          />
        </div>
        <p className="mt-4 text-[13px] text-muted">
          Large files can use the chunked upload endpoints, the same ones the web app uses, with resumable sessions and SHA-256 verification.
        </p>
      </Section>

      <Section eyebrow="Keys and limits" title="Least privilege, visible limits" className="bg-surface-2/40">
        <div className="grid gap-10 lg:grid-cols-2">
          <div>
            <h3 className="text-[15px] font-semibold">Scopes</h3>
            <dl className="mt-3 divide-y divide-line border-y border-line text-[13px]">
              {SCOPE_DOCS.map((s) => (
                <div key={s.scope} className="grid gap-1 py-2.5 sm:grid-cols-[10rem_1fr] sm:gap-4">
                  <dt className="font-mono text-xs">{s.scope}</dt>
                  <dd className="text-muted">{s.description}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div>
            <h3 className="text-[15px] font-semibold">Rate limits by plan</h3>
            <div role="region" aria-label="Rate limits by plan" tabIndex={0} className="mt-3 overflow-x-auto rounded-lg border border-line bg-surface">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-subtle">
                    <th className="px-4 py-2 font-medium">Plan</th>
                    <th className="px-3 py-2 font-medium">Requests</th>
                    <th className="px-3 py-2 font-medium">API keys</th>
                    <th className="px-3 py-2 font-medium">Webhooks</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {plans.map((p) => (
                    <tr key={p.key}>
                      <th scope="row" className="px-4 py-2 text-left font-medium">
                        {p.name}
                        {!p.features.api && <span className="ml-2 text-xs font-normal text-subtle">no API</span>}
                      </th>
                      <td className="px-3 py-2 tnum">{p.features.api ? formatLimit("apiRequestsPerMinute", p.limits.apiRequestsPerMinute) : "—"}</td>
                      <td className="px-3 py-2 tnum">{p.features.api ? formatLimit("apiKeys", p.limits.apiKeys) : "—"}</td>
                      <td className="px-3 py-2 tnum">{p.features.webhooks ? formatLimit("webhooks", p.limits.webhooks) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-[13px] leading-relaxed text-muted">
              Over the limit you get <code className="font-mono text-xs">429</code> with a <code className="font-mono text-xs">Retry-After</code> header. Errors always use one shape: <code className="font-mono text-xs">{`{ "error": { "code", "message" } }`}</code>.
            </p>
          </div>
        </div>
      </Section>

      <Section id="webhooks" eyebrow="Webhooks" title="Events you can verify" lead="Each delivery is a JSON POST with a timestamped HMAC-SHA256 signature. Failed deliveries retry with backoff, endpoints that keep failing are switched off, and every delivery can be replayed from the log.">
        <div className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
          <CodeBlock label="Verify a signature (Node.js)" code={VERIFY} />
          <div>
            <h3 className="text-[15px] font-semibold">Events</h3>
            <ul tabIndex={0} aria-label="Webhook events" className="mt-3 max-h-80 space-y-1.5 overflow-y-auto pr-2 text-[13px]">
              {EVENT_TYPES.map((t) => (
                <li key={t}>
                  <code className="font-mono text-xs">{t}</code>
                  <span className="block text-xs text-subtle">{EVENTS[t].description}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      <section>
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-14 sm:px-6">
          <div>
            <h2 className="mk-display text-2xl">Something missing from the reference?</h2>
            <p className="mt-1 text-[13px] text-muted">
              Tell us on the{" "}
              <Link href="/contact" className="text-accent hover:underline">
                contact page
              </Link>
              . The docs page is generated from the same table the API is built against, so gaps are bugs.
            </p>
          </div>
          <ButtonLink href="/developer/docs" variant="primary">
            Open the reference
          </ButtonLink>
        </div>
      </section>
    </>
  );
}
