"use client";

import { Highlight, themes } from "prism-react-renderer";
import { cn } from "@/lib/cn";
import { useDocumentAttribute } from "@/lib/useStoredValue";

const ALIASES: Record<string, string> = {
  js: "javascript", mjs: "javascript", cjs: "javascript", ts: "typescript", py: "python", rb: "ruby", sh: "bash", zsh: "bash", yml: "yaml",
  htm: "markup", html: "markup", xml: "markup", svg: "markup", rs: "rust", kt: "kotlin", cs: "csharp", h: "c", hpp: "cpp", md: "markdown", ps1: "powershell",
};

export function languageFor(extension: string): string {
  const e = extension.toLowerCase().replace(/^\./, "");
  return ALIASES[e] ?? e;
}

interface Props {
  code: string;
  language: string;
  lineNumbers?: boolean;
  className?: string;
  maxHeight?: string;
}

/** Syntax highlighting rendered as React elements (no innerHTML), with a light/dark theme that follows the app. */
export function CodeBlock({ code, language, lineNumbers, className, maxHeight }: Props) {
  const attr = useDocumentAttribute("data-theme", "system");
  const dark = attr === "dark" || (attr !== "light" && typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  return (
    <Highlight theme={dark ? themes.vsDark : themes.vsLight} code={code.replace(/\n$/, "")} language={languageFor(language) || "text"}>
      {({ className: cls, style, tokens, getLineProps, getTokenProps }) => (
        <pre className={cn(cls, "overflow-auto rounded-md border border-line p-3 font-mono text-xs leading-relaxed", className)} style={{ ...style, maxHeight }} tabIndex={0}>
          {tokens.map((line, i) => (
            <div key={i} {...getLineProps({ line })} className="table-row">
              {lineNumbers && (
                <span aria-hidden className="table-cell pr-4 text-right align-top text-[11px] opacity-50 select-none tnum">
                  {i + 1}
                </span>
              )}
              <span className="table-cell break-words whitespace-pre-wrap">
                {line.map((token, ti) => (
                  <span key={ti} {...getTokenProps({ token })} />
                ))}
              </span>
            </div>
          ))}
        </pre>
      )}
    </Highlight>
  );
}
