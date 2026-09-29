"use client";

import { CircleHelp } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Pop } from "@/components/ui/Overlays";

const EXAMPLES: Array<[string, string]> = [
  ["type:image", "images (also video, audio, document, archive, code)"],
  ["ext:pdf", "by file extension"],
  ["size:>1GB", "bigger than 1 GB (<, >=, <=, or 10MB..1GB)"],
  ["folder:videos", "inside folders named like “videos”"],
  ["tag:project", "carrying a tag (repeat for several)"],
  ["modified:<7d", "changed within the last 7 days"],
  ["created:>1y", "older than a year"],
  ["created:2030-01-31", "on or after a date"],
  ["is:shared", "also private, favorite, archived"],
  ["has:versions", "also comments, description, tags"],
  ["mime:image/*", "by content type"],
  ["owner:me", "uploaded by you"],
  ["-tag:draft", "put - in front of any term to exclude it"],
  ["\"annual report\"", "an exact phrase in the name"],
];

/** Explains the search operators. The list is what the parser actually accepts (see lib/search.ts). */
export function SearchHelp() {
  return (
    <Pop
      label="Search operators"
      placement="bottom-start"
      className="w-[26rem] p-4"
      trigger={
        <Button size="icon-sm" variant="ghost" aria-label="How to search">
          <CircleHelp className="size-4" aria-hidden />
        </Button>
      }
    >
      <h2 className="text-[13px] font-semibold">Search operators</h2>
      <p className="mt-1 text-xs text-muted">Combine words and operators freely. Every term must match.</p>
      <dl className="mt-3 grid grid-cols-[9.5rem_1fr] gap-x-3 gap-y-1.5 text-xs">
        {EXAMPLES.map(([op, what]) => (
          <div key={op} className="contents">
            <dt className="font-mono text-fg">{op}</dt>
            <dd className="text-muted">{what}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs text-subtle">Example: <code className="font-mono">type:video size:&gt;500MB -tag:archive</code></p>
    </Pop>
  );
}
