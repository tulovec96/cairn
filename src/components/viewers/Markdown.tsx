import type { ReactNode } from "react";
import { CodeBlock } from "./CodeBlock";

/**
 * A small Markdown renderer that builds React elements directly. It never uses innerHTML and never emits
 * raw HTML from the source, so an uploaded .md file can't inject markup or scripts. Links are limited to
 * http(s) and mailto; images are shown as their alt text (loading remote images would leak the reader's IP).
 */

const SAFE_LINK = /^(https?:\/\/|mailto:)/i;

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let n = 0;
  const key = () => `${keyBase}-${n++}`;
  const patterns: Array<[RegExp, (m: RegExpExecArray) => ReactNode]> = [
    [/^`([^`]+)`/, (m) => <code key={key()} className="rounded bg-surface-3 px-1 py-0.5 font-mono text-[0.9em]">{m[1]}</code>],
    [/^!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/, (m) => <span key={key()} className="text-muted italic">[image: {m[1] || "no description"}]</span>],
    [
      /^\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/,
      (m) =>
        SAFE_LINK.test(m[2]) ? (
          <a key={key()} href={m[2]} target="_blank" rel="noopener noreferrer nofollow" className="text-accent underline underline-offset-2">
            {inline(m[1], key())}
          </a>
        ) : (
          <span key={key()}>{m[1]}</span>
        ),
    ],
    [/^\*\*([^*]+)\*\*/, (m) => <strong key={key()}>{inline(m[1], key())}</strong>],
    [/^__([^_]+)__/, (m) => <strong key={key()}>{inline(m[1], key())}</strong>],
    [/^\*([^*\s][^*]*)\*/, (m) => <em key={key()}>{inline(m[1], key())}</em>],
    [/^_([^_\s][^_]*)_/, (m) => <em key={key()}>{inline(m[1], key())}</em>],
    [/^~~([^~]+)~~/, (m) => <s key={key()}>{inline(m[1], key())}</s>],
    [/^(https?:\/\/[^\s<>()]+)/, (m) => <a key={key()} href={m[1]} target="_blank" rel="noopener noreferrer nofollow" className="text-accent underline underline-offset-2 break-all">{m[1]}</a>],
  ];
  while (rest.length) {
    let matched = false;
    for (const [re, render] of patterns) {
      const m = re.exec(rest);
      if (m) {
        out.push(render(m));
        rest = rest.slice(m[0].length);
        matched = true;
        break;
      }
    }
    if (matched) continue;
    // Plain text up to the next character that could start markup.
    const next = rest.slice(1).search(/[`*_~\[!h]/);
    const chunk = next < 0 ? rest : rest.slice(0, next + 1);
    out.push(chunk);
    rest = rest.slice(chunk.length);
  }
  return out;
}

interface ListItem {
  text: string;
  task: boolean | null;
  children: ListItem[];
}

function parseList(lines: string[], start: number, indent: number, ordered: boolean): { items: ListItem[]; next: number } {
  const items: ListItem[] = [];
  let i = start;
  const marker = ordered ? /^(\s*)\d+[.)]\s+(.*)$/ : /^(\s*)[-*+]\s+(.*)$/;
  while (i < lines.length) {
    const m = marker.exec(lines[i]);
    if (!m || m[1].length !== indent) break;
    let text = m[2];
    let task: boolean | null = null;
    const t = /^\[( |x|X)\]\s+(.*)$/.exec(text);
    if (t) {
      task = t[1].toLowerCase() === "x";
      text = t[2];
    }
    const item: ListItem = { text, task, children: [] };
    i++;
    while (i < lines.length) {
      const sub = /^(\s+)([-*+]|\d+[.)])\s+/.exec(lines[i]);
      if (!sub || sub[1].length <= indent) break;
      const nested = parseList(lines, i, sub[1].length, /\d/.test(sub[2]));
      item.children.push(...nested.items);
      i = nested.next;
    }
    items.push(item);
  }
  return { items, next: i };
}

function renderList(items: ListItem[], ordered: boolean, key: string): ReactNode {
  const Tag = ordered ? "ol" : "ul";
  return (
    <Tag key={key} className={ordered ? "my-2 list-decimal space-y-1 pl-6" : "my-2 list-disc space-y-1 pl-6"}>
      {items.map((it, i) => (
        <li key={i} className={it.task !== null ? "-ml-6 flex list-none gap-2" : undefined}>
          {it.task !== null && <input type="checkbox" checked={it.task} readOnly aria-label={it.task ? "Done" : "Not done"} className="mt-1 size-3.5" />}
          <span>
            {inline(it.text, `${key}-${i}`)}
            {it.children.length > 0 && renderList(it.children, false, `${key}-${i}-c`)}
          </span>
        </li>
      ))}
    </Tag>
  );
}

export function Markdown({ source }: { source: string }) {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let k = 0;
  const key = () => `b${k++}`;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = /^```\s*([\w+-]*)\s*$/.exec(line);
    if (fence) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) code.push(lines[i++]);
      i++;
      blocks.push(<CodeBlock key={key()} code={code.join("\n")} language={fence[1] || "text"} className="my-3" />);
      continue;
    }
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      const level = h[1].length;
      const sizes = ["text-2xl", "text-xl", "text-lg", "text-base", "text-sm", "text-sm"];
      const Tag = `h${level}` as "h1";
      blocks.push(
        <Tag key={key()} className={`mt-5 mb-2 font-semibold tracking-tight ${sizes[level - 1]} ${level <= 2 ? "border-b border-line pb-1" : ""}`}>
          {inline(h[2], `h${k}`)}
        </Tag>,
      );
      i++;
      continue;
    }
    if (/^(\s*)([-*_])(\s*\2){2,}\s*$/.test(line)) {
      blocks.push(<hr key={key()} className="my-4 border-line" />);
      i++;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^>\s?/, ""));
      blocks.push(
        <blockquote key={key()} className="my-3 border-l-4 border-line-strong pl-4 text-muted">
          <Markdown source={quote.join("\n")} />
        </blockquote>,
      );
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const indent = /^(\s*)/.exec(line)![1].length;
      const { items, next } = parseList(lines, i, indent, ordered);
      blocks.push(renderList(items, ordered, key()));
      i = next;
      continue;
    }
    if (/\|/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
      const split = (l: string) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const head = split(line);
      const aligns = split(lines[i + 1]).map((c) => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : "left"));
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim()) rows.push(split(lines[i++]));
      blocks.push(
        <div key={key()} role="region" aria-label="Table" tabIndex={0} className="my-3 overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                {head.map((c, ci) => (
                  <th key={ci} style={{ textAlign: aligns[ci] as "left" }} className="border border-line bg-surface-2 px-3 py-1.5 font-semibold">
                    {inline(c, `th${ci}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {head.map((_, ci) => (
                    <td key={ci} style={{ textAlign: aligns[ci] as "left" }} className="border border-line px-3 py-1.5">
                      {inline(r[ci] ?? "", `td${ri}-${ci}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|>\s?|\s*[-*+]\s+|\s*\d+[.)]\s+)/.test(lines[i])) para.push(lines[i++]);
    if (!para.length) para.push(lines[i++]);
    blocks.push(
      <p key={key()} className="my-2 leading-relaxed">
        {para.map((p, pi) => (
          <span key={pi}>
            {inline(p.replace(/\s{2,}$/, ""), `p${k}-${pi}`)}
            {pi < para.length - 1 && (/\s{2}$/.test(p) ? <br /> : " ")}
          </span>
        ))}
      </p>,
    );
  }
  return <div className="text-[14px] break-words">{blocks}</div>;
}
