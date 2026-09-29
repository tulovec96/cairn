"use client";

import { AlertTriangle, ListTree, WrapText } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Feedback";
import { cn } from "@/lib/cn";
import { formatBytes } from "@/lib/format";
import { CodeBlock } from "./CodeBlock";
import { Markdown } from "./Markdown";

type Mode = "markdown" | "json" | "csv" | "log" | "code" | "plain";

const CODE_LANGS = new Set([
  "js", "mjs", "cjs", "ts", "tsx", "jsx", "css", "scss", "html", "htm", "xml", "yml", "yaml", "toml", "ini", "py", "rb", "go", "rs", "java", "kt", "c", "h", "cpp", "hpp", "cs", "php",
  "sh", "bash", "zsh", "bat", "ps1", "sql", "lua", "swift", "dart", "vue", "svelte", "diff", "patch", "graphql",
]);

export function modeFor(extension: string): Mode {
  const e = extension.toLowerCase();
  if (e === "md" || e === "markdown") return "markdown";
  if (e === "json") return "json";
  if (e === "csv" || e === "tsv") return "csv";
  if (e === "log") return "log";
  if (CODE_LANGS.has(e)) return "code";
  return "plain";
}

/** RFC 4180-style parser: quoted fields, escaped quotes and embedded newlines. */
export function parseCsv(text: string, delimiter: string, maxRows: number): { rows: string[][]; more: boolean } {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      if (rows.length >= maxRows) return { rows, more: i < text.length - 1 };
    } else field += ch;
    i++;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return { rows, more: false };
}

function JsonView({ text }: { text: string }) {
  const parsed = useMemo(() => {
    try {
      return { ok: true as const, pretty: JSON.stringify(JSON.parse(text), null, 2) };
    } catch (err) {
      return { ok: false as const, message: (err as Error).message };
    }
  }, [text]);
  if (!parsed.ok) {
    return (
      <div>
        <p className="mb-2 flex items-center gap-1.5 text-xs text-warning">
          <AlertTriangle className="size-3.5" aria-hidden /> Not valid JSON ({parsed.message}). Showing the raw text.
        </p>
        <CodeBlock code={text} language="json" lineNumbers />
      </div>
    );
  }
  return <CodeBlock code={parsed.pretty} language="json" lineNumbers />;
}

function CsvView({ text, delimiter }: { text: string; delimiter: string }) {
  const [header, setHeader] = useState(true);
  const { rows, more } = useMemo(() => parseCsv(text, delimiter, 500), [text, delimiter]);
  if (!rows.length) return <p className="p-6 text-center text-[13px] text-muted">This file is empty.</p>;
  const cols = Math.max(...rows.map((r) => r.length));
  const head = header ? rows[0] : null;
  const body = header ? rows.slice(1) : rows;
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-xs text-muted">
        <span className="tnum">{rows.length.toLocaleString("en-US")}{more ? "+" : ""} rows · {cols} columns</span>
        <label className="inline-flex cursor-pointer items-center gap-1.5">
          <input type="checkbox" checked={header} onChange={(e) => setHeader(e.target.checked)} className="size-3.5" /> First row is a header
        </label>
      </div>
      <div className="max-h-[32rem] overflow-auto rounded-md border border-line">
        <table className="w-full border-collapse text-xs">
          {head && (
            <thead className="sticky top-0 bg-surface-2">
              <tr>
                {Array.from({ length: cols }, (_, c) => (
                  <th key={c} scope="col" className="border-b border-line px-2.5 py-1.5 text-left font-semibold whitespace-nowrap">
                    {head[c] ?? ""}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {body.map((r, ri) => (
              <tr key={ri} className="odd:bg-surface even:bg-surface-2/40">
                {Array.from({ length: cols }, (_, c) => (
                  <td key={c} className="max-w-64 truncate border-b border-line px-2.5 py-1" title={r[c]}>
                    {r[c] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {more && <p className="mt-2 text-xs text-subtle">Showing the first 500 rows. Download the file to see everything.</p>}
    </div>
  );
}

function LogView({ text }: { text: string }) {
  const [filter, setFilter] = useState("");
  const [wrap, setWrap] = useState(false);
  const lines = useMemo(() => text.split(/\r?\n/), [text]);
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return lines.map((l, i) => ({ l, i })).filter(({ l }) => !f || l.toLowerCase().includes(f)).slice(0, 5000);
  }, [lines, filter]);
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <input value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter log lines" placeholder="Filter lines…" className="h-8 min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-2.5 text-xs" />
        <Button size="sm" variant={wrap ? "primary" : "secondary"} onClick={() => setWrap((w) => !w)} icon={<WrapText className="size-3.5" aria-hidden />} aria-pressed={wrap}>
          Wrap
        </Button>
      </div>
      <div className="max-h-[32rem] overflow-auto rounded-md border border-line bg-surface font-mono text-xs leading-relaxed" tabIndex={0}>
        {shown.map(({ l, i }) => (
          <div key={i} className={cn("flex gap-3 px-3 hover:bg-surface-2", /\b(error|fatal|panic|exception)\b/i.test(l) && "bg-danger-soft text-danger", /\bwarn(ing)?\b/i.test(l) && "bg-warning-soft text-warning")}>
            <span aria-hidden className="w-10 shrink-0 text-right text-subtle select-none tnum">{i + 1}</span>
            <span className={wrap ? "break-all whitespace-pre-wrap" : "whitespace-pre"}>{l}</span>
          </div>
        ))}
        {shown.length === 0 && <p className="p-4 text-center text-muted">No lines match.</p>}
      </div>
    </div>
  );
}

interface Props {
  src: string;
  size: number;
  extension: string;
  name: string;
  maxBytes?: number;
}

/** Loads the first `maxBytes` of a file through the safe preview endpoint and shows it in the best format for its type. */
export function TextViewer({ src, size, extension, name, maxBytes = 256 * 1024 }: Props) {
  const [state, setState] = useState<{ text: string } | { error: string } | null>(null);
  const [raw, setRaw] = useState(false);
  const mode = modeFor(extension);
  useEffect(() => {
    const ctrl = new AbortController();
    fetch(src, { headers: { range: `bytes=0-${maxBytes - 1}` }, signal: ctrl.signal, credentials: "same-origin" })
      .then(async (r) => {
        if (!r.ok && r.status !== 206) throw new Error("This file can't be previewed right now.");
        setState({ text: new TextDecoder("utf-8", { fatal: false }).decode(await r.arrayBuffer()) });
      })
      .catch((e: Error) => e.name !== "AbortError" && setState({ error: e.message }));
    return () => ctrl.abort();
  }, [src, maxBytes]);

  if (!state)
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  if ("error" in state) return <p className="p-6 text-center text-[13px] text-muted">{state.error}</p>;
  const truncated = size > maxBytes;
  const canToggle = mode === "markdown" || mode === "json" || mode === "csv";
  return (
    <div className="p-3">
      {canToggle && (
        <div className="mb-2 flex justify-end">
          <Button size="sm" variant="ghost" onClick={() => setRaw((v) => !v)} icon={<ListTree className="size-3.5" aria-hidden />}>
            {raw ? "Formatted view" : "Raw text"}
          </Button>
        </div>
      )}
      {raw || mode === "plain" ? (
        <pre className="max-h-[32rem] overflow-auto font-mono text-xs leading-relaxed break-words whitespace-pre-wrap text-fg" tabIndex={0}>
          {state.text}
        </pre>
      ) : mode === "markdown" ? (
        <div className="max-h-[36rem] overflow-auto px-1">
          <Markdown source={state.text} />
        </div>
      ) : mode === "json" ? (
        <JsonView text={state.text} />
      ) : mode === "csv" ? (
        <CsvView text={state.text} delimiter={extension.toLowerCase() === "tsv" ? "\t" : ","} />
      ) : mode === "log" ? (
        <LogView text={state.text} />
      ) : (
        <CodeBlock code={state.text} language={extension} lineNumbers maxHeight="32rem" />
      )}
      {truncated && (
        <p className="mt-2 text-xs text-subtle">
          Showing the first {formatBytes(maxBytes, 0)} of {name}. JSON and CSV views may be incomplete; download the file to see everything.
        </p>
      )}
    </div>
  );
}
