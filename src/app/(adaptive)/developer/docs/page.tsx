import type { Metadata } from "next";
import { CodeBlock } from "@/components/api/CodeBlock";
import { Badge } from "@/components/ui/Feedback";
import { ERROR_CODES, SCOPE_DOCS, buildSections, type Endpoint, type Param } from "@/lib/api-docs";
import { cn } from "@/lib/cn";
import { formatBytes } from "@/lib/format";
import { env } from "@/server/env";
import { getSettings } from "@/server/settings";

export const metadata: Metadata = { title: "API documentation" };

const METHOD_TONE: Record<Endpoint["method"], string> = {
  GET: "bg-success-soft text-success",
  POST: "bg-accent-soft text-accent",
  PUT: "bg-warning-soft text-warning",
  PATCH: "bg-warning-soft text-warning",
  DELETE: "bg-danger-soft text-danger",
};

function ParamTable({ title, params }: { title: string; params: Param[] }) {
  return (
    <div>
      <h4 className="mb-1.5 text-xs font-semibold tracking-wide text-subtle uppercase">{title}</h4>
      <div role="region" aria-label="Endpoints" tabIndex={0} className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[32rem] text-left text-[13px]">
          <tbody className="divide-y divide-line">
            {params.map((p) => (
              <tr key={p.name}>
                <td className="w-40 px-3 py-2 align-top font-mono text-xs whitespace-nowrap">
                  {p.name}
                  {p.required && <span className="ml-1 text-danger" title="Required">*</span>}
                </td>
                <td className="w-52 px-3 py-2 align-top font-mono text-xs text-muted">{p.type}</td>
                <td className="px-3 py-2 align-top text-muted">{p.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EndpointCard({ e }: { e: Endpoint }) {
  return (
    <article id={e.id} className="scroll-mt-20 rounded-lg border border-line bg-surface">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line px-4 py-3">
        <span className={cn("rounded px-2 py-0.5 font-mono text-xs font-semibold", METHOD_TONE[e.method])}>{e.method}</span>
        <code className="font-mono text-[13px] font-medium break-all">{e.path}</code>
        <span className="ml-auto flex items-center gap-1.5">
          {e.auth === "none" ? <Badge>Public</Badge> : e.auth === "session" ? <Badge>Browser session</Badge> : <Badge tone="accent">API key</Badge>}
          {e.scope && <Badge tone="neutral"><span className="font-mono">{e.scope}</span></Badge>}
        </span>
      </header>
      <div className="space-y-4 px-4 py-4">
        <div>
          <h3 className="text-sm font-semibold">{e.summary}</h3>
          {e.description && <p className="mt-1 text-[13px] leading-relaxed text-muted">{e.description}</p>}
        </div>
        {e.query && <ParamTable title="Query parameters" params={e.query} />}
        {e.body && <ParamTable title="Body" params={e.body} />}
        {e.example && <CodeBlock code={e.example} label="Example" />}
        {e.response && <CodeBlock code={e.response} label="Response" />}
      </div>
    </article>
  );
}

export default async function DocsPage() {
  const base = env.appUrl;
  const settings = await getSettings();
  const sections = buildSections(base);
  const r = settings.rateLimits;
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <div className="lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10">
        <nav aria-label="Documentation sections" className="mb-6 lg:sticky lg:top-6 lg:mb-0 lg:self-start">
          <p className="mb-2 text-xs font-semibold tracking-wide text-subtle uppercase">On this page</p>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] lg:flex-col lg:gap-1">
            {[["authentication", "Authentication"], ...sections.map((s) => [s.id, s.title]), ["errors", "Errors"], ["limits", "Rate limits"]].map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`} className="text-muted hover:text-fg">
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 space-y-12">
          <header>
            <h1 className="text-2xl font-semibold tracking-tight">API documentation</h1>
            <p className="mt-2 max-w-2xl text-[15px] text-muted">
              A JSON HTTP API for uploading, organizing and sharing files. Everything below is implemented and is what the web app itself uses. Base URL: <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px]">{base}</code>
            </p>
          </header>

          <section id="authentication" className="scroll-mt-20 space-y-4">
            <h2 className="text-lg font-semibold tracking-tight">Authentication</h2>
            <p className="text-[13px] leading-relaxed text-muted">
              Send an API key as a Bearer token. Create keys under <em>API Keys</em> after signing in; each key has scopes and can expire or be revoked. Keys are shown once and stored only as a SHA-256 hash.
              Every upload needs an account. Endpoints marked <em>Public</em> need no credentials (share links and file-request pages are separate from accounts).
            </p>
            <CodeBlock code={`curl -H "Authorization: Bearer cairn_YOUR_KEY" ${base}/api/v1/files`} label="Request" />
            <div role="region" aria-label="Parameters" tabIndex={0} className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full text-left text-[13px]">
                <thead className="border-b border-line bg-surface-2 text-xs text-subtle">
                  <tr>
                    <th className="px-3 py-2 font-medium">Scope</th>
                    <th className="px-3 py-2 font-medium">Allows</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {SCOPE_DOCS.map((s) => (
                    <tr key={s.scope}>
                      <td className="px-3 py-2 font-mono text-xs">{s.scope}</td>
                      <td className="px-3 py-2 text-muted">{s.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[13px] text-muted">Managing API keys, sessions and account settings requires a browser session; keys can&apos;t create other keys. Requests made with a key are recorded (endpoint pattern, status, latency; never ids or secrets) for your usage view.</p>
          </section>

          {sections.map((section) => (
            <section key={section.id} id={section.id} className="scroll-mt-20 space-y-4">
              <div>
                <h2 className="text-lg font-semibold tracking-tight">{section.title}</h2>
                {section.intro && <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-muted">{section.intro}</p>}
              </div>
              {section.endpoints.map((e) => (
                <EndpointCard key={e.id} e={e} />
              ))}
            </section>
          ))}

          <section id="errors" className="scroll-mt-20 space-y-4">
            <h2 className="text-lg font-semibold tracking-tight">Errors</h2>
            <p className="text-[13px] text-muted">Every error uses the same envelope, with a stable machine-readable <code className="font-mono">code</code> and a human-readable <code className="font-mono">message</code>. Internal details are never included.</p>
            <CodeBlock
              label="Error response"
              code={`HTTP/1.1 409 Conflict
{
  "error": {
    "code": "incomplete_upload",
    "message": "Some chunks have not been received yet.",
    "details": { "missing": [3, 7] }
  }
}`}
            />
            <div role="region" aria-label="Error codes" tabIndex={0} className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full min-w-[30rem] text-left text-[13px]">
                <thead className="border-b border-line bg-surface-2 text-xs text-subtle">
                  <tr>
                    <th className="px-3 py-2 font-medium">Code</th>
                    <th className="px-3 py-2 font-medium">HTTP</th>
                    <th className="px-3 py-2 font-medium">Meaning</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {ERROR_CODES.map((c) => (
                    <tr key={c.code}>
                      <td className="px-3 py-2 font-mono text-xs">{c.code}</td>
                      <td className="px-3 py-2 tnum">{c.status}</td>
                      <td className="px-3 py-2 text-muted">{c.meaning}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section id="limits" className="scroll-mt-20 space-y-4">
            <h2 className="text-lg font-semibold tracking-tight">Rate limits</h2>
            <p className="text-[13px] leading-relaxed text-muted">
              API-key traffic is limited per account by the plan (requests per minute); browser sessions and anonymous traffic use the site-wide limits below, keyed by account where possible so shared IPs don&apos;t penalize each other. When exceeded the API answers <code className="font-mono">429 rate_limited</code> with a <code className="font-mono">Retry-After</code> header (seconds). The values below are this server&apos;s current settings.
            </p>
            <div role="region" aria-label="Scopes" tabIndex={0} className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full min-w-[26rem] text-left text-[13px]">
                <tbody className="divide-y divide-line">
                  {[
                    ["API requests", r.api],
                    ["Chunk uploads", r.chunk],
                    ["Downloads", r.download],
                    ["Upload sessions started", r.upload],
                    ["File request uploads (per address)", r.requestUpload],
                    ["Share creation", r.shareCreate],
                    ["Password attempts on a link", r.shareUnlock],
                    ["Abuse reports", r.report],
                  ].map(([label, rule]) => {
                    const rr = rule as { limit: number; windowSec: number };
                    return (
                      <tr key={label as string}>
                        <td className="px-3 py-2">{label as string}</td>
                        <td className="px-3 py-2 text-muted tnum">
                          {rr.limit.toLocaleString("en-US")} per {rr.windowSec >= 3600 ? `${rr.windowSec / 3600} h` : rr.windowSec >= 60 ? `${rr.windowSec / 60} min` : `${rr.windowSec} s`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-[13px] text-muted">
              File size, storage and API rate limits come from your plan (see the pricing page). Chunk size is {formatBytes(settings.uploads.chunkSizeBytes, 0)}.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
