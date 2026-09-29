import { cn } from "@/lib/cn";

const STONES = [
  { width: "38%", tone: "bg-accent/55", title: "Share on your terms", body: "Links with passwords, expiry, download and view limits, view-only mode and IP allow-lists. Revoke any time." },
  { width: "58%", tone: "bg-accent/75", title: "Scanned before release", body: "Uploads pass a malware scan or file-type rules. Anything suspicious is quarantined for a person to review." },
  { width: "78%", tone: "bg-accent/90", title: "Verified with SHA-256", body: "Your browser hashes the file, the server hashes what it received. A mismatch is rejected, never stored." },
  { width: "100%", tone: "bg-accent", title: "Uploaded in resumable chunks", body: "Lose your connection, close the tab, come back tomorrow. The upload continues where it stopped." },
] as const;

/** The product as a cairn: four stones, each one a real stage a file passes through. */
export function CairnStack({ className }: { className?: string }) {
  return (
    <ol aria-label="How Cairn handles a file, from the foundation up" className={cn("space-y-2.5", className)}>
      {STONES.map((s, i) => (
        <li key={s.title} className="grid grid-cols-[minmax(0,9.5rem)_1fr] items-center gap-4 sm:grid-cols-[minmax(0,13rem)_1fr]">
          <div className="flex justify-center" aria-hidden>
            <div className={cn("h-11 rounded-[999px] shadow-[inset_0_-3px_0_rgb(0_0_0/0.12)] sm:h-12", s.tone)} style={{ width: s.width }} />
          </div>
          <div>
            <p className="text-[13px] font-semibold">
              <span className="mr-2 font-mono text-xs text-subtle">{String(STONES.length - i).padStart(2, "0")}</span>
              {s.title}
            </p>
            <p className="mt-0.5 text-[13px] leading-snug text-muted">{s.body}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
