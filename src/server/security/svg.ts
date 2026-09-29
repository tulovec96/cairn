/**
 * Conservative SVG sanitizer used for previews. It removes anything that can run code or fetch
 * resources: scripts, foreignObject, embedded documents, event handlers, external references,
 * DOCTYPE/entity declarations and processing instructions. Previews are additionally served with a
 * sandboxing CSP and displayed through <img>, so this is defence in depth rather than the only barrier.
 */

const DROP_ELEMENTS = new Set([
  "script", "foreignobject", "iframe", "frame", "frameset", "embed", "object", "applet", "audio", "video", "canvas",
  "animate", "set", "animatetransform", "animatemotion", "handler", "listener", "link", "meta", "base", "form", "input", "button", "textarea", "select", "portal",
]);

const URL_ATTRS = new Set(["href", "xlink:href", "src", "action", "formaction", "data", "poster", "background"]);

function isSafeHref(value: string): boolean {
  const v = value.trim().replace(/[\u0000-\u001f\u007f\s]+/g, "").toLowerCase();
  if (v.startsWith("#")) return true;
  return /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=]+$/.test(v);
}

function cleanCss(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/@import[^;]*;?/gi, "")
    .replace(/expression\s*\(/gi, "blocked(")
    .replace(/url\s*\(\s*(['"]?)(?!#)[^)]*\)/gi, "none")
    .replace(/javascript\s*:/gi, "blocked:");
}

interface Attr {
  name: string;
  value: string | null;
}

function parseAttrs(src: string): Attr[] {
  const attrs: Attr[] = [];
  const re = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) attrs.push({ name: m[1], value: m[2] ?? m[3] ?? m[4] ?? null });
  return attrs;
}

function escapeAttr(v: string): string {
  return v.replace(/&(?!(?:[a-z]+|#\d+|#x[0-9a-f]+);)/gi, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

export function sanitizeSvg(input: string): string {
  let src = input.replace(/^﻿/, "");
  // Processing instructions (xml-stylesheet), DOCTYPE with entities, CDATA-wrapped script tricks and comments.
  src = src.replace(/<\?[\s\S]*?\?>/g, "").replace(/<!DOCTYPE[\s\S]*?(\[[\s\S]*?\])?\s*>/gi, "").replace(/<!--[\s\S]*?-->/g, "");

  let out = "";
  let i = 0;
  let skipDepth = 0;
  let skipName = "";
  let inStyle = false;
  let styleBuf = "";

  while (i < src.length) {
    const lt = src.indexOf("<", i);
    if (lt === -1) {
      if (!skipDepth) out += inStyle ? "" : src.slice(i);
      break;
    }
    if (!skipDepth) {
      const text = src.slice(i, lt);
      if (inStyle) styleBuf += text;
      else out += text;
    }
    // Find the end of the tag, honoring quoted attribute values.
    let j = lt + 1;
    let quote: string | null = null;
    while (j < src.length) {
      const ch = src[j];
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === ">") break;
      j++;
    }
    const raw = src.slice(lt + 1, j);
    i = j + 1;

    if (raw.startsWith("![CDATA[")) {
      // Keep CDATA payload only inside <style>, otherwise drop it.
      const end = src.indexOf("]]>", lt);
      const body = src.slice(lt + 9, end === -1 ? src.length : end);
      if (inStyle) styleBuf += body;
      i = end === -1 ? src.length : end + 3;
      continue;
    }

    const closing = raw.startsWith("/");
    const selfClosing = raw.endsWith("/");
    const body = raw.replace(/^\//, "").replace(/\/$/, "");
    const nameMatch = /^([^\s/>]+)/.exec(body);
    if (!nameMatch) continue;
    const name = nameMatch[1];
    const lname = name.toLowerCase().replace(/^svg:/, "");

    if (skipDepth) {
      if (lname === skipName) {
        if (closing) skipDepth--;
        else if (!selfClosing) skipDepth++;
      }
      continue;
    }
    if (DROP_ELEMENTS.has(lname)) {
      if (!closing && !selfClosing) {
        skipDepth = 1;
        skipName = lname;
      }
      continue;
    }
    if (lname === "style") {
      if (closing) {
        out += `<style>${cleanCss(styleBuf)}</style>`;
        styleBuf = "";
        inStyle = false;
      } else if (!selfClosing) inStyle = true;
      continue;
    }
    if (closing) {
      out += `</${name}>`;
      continue;
    }

    const attrs = parseAttrs(body.slice(name.length));
    const kept: string[] = [];
    for (const a of attrs) {
      const an = a.name.toLowerCase();
      if (an.startsWith("on")) continue;
      if (an === "style" && a.value !== null) {
        kept.push(`style="${escapeAttr(cleanCss(a.value))}"`);
        continue;
      }
      if (URL_ATTRS.has(an)) {
        if (a.value === null || !isSafeHref(a.value)) continue;
      }
      if (a.value !== null && /javascript\s*:|vbscript\s*:|data\s*:\s*text\/html/i.test(a.value.replace(/[\u0000-\u001f\s]+/g, ""))) continue;
      if (a.value !== null && /url\s*\(\s*['"]?\s*(?!#)/i.test(a.value) && !/^url\(#/i.test(a.value.trim())) {
        kept.push(`${a.name}="${escapeAttr(a.value.replace(/url\s*\(\s*(['"]?)(?!#)[^)]*\)/gi, "none"))}"`);
        continue;
      }
      kept.push(a.value === null ? a.name : `${a.name}="${escapeAttr(a.value)}"`);
    }
    out += `<${name}${kept.length ? " " + kept.join(" ") : ""}${selfClosing ? "/" : ""}>`;
  }
  return out;
}
