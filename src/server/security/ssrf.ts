import dns from "node:dns";
import net from "node:net";
import { Agent, fetch as undiciFetch, type RequestInit } from "undici";
import { Errors } from "../errors";

/**
 * Server-side request forgery protection for anything the server fetches on a user's behalf
 * (webhook deliveries, URL imports).
 *
 * - Only http(s), no credentials embedded in the URL.
 * - The destination is validated *at connect time* (via a custom DNS lookup), so a hostname that
 *   resolves to an internal address, or is re-pointed after validation ("DNS rebinding"), is refused.
 * - Loopback, private, link-local, CGNAT, multicast, unspecified and metadata addresses are blocked.
 * - Redirects are never followed automatically; callers that need them use `safeFetchFollow`, which
 *   re-validates every hop and caps the count.
 */

export function isPrivateAddress(addr: string): boolean {
  const ip = addr.replace(/^::ffff:/i, "");
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      (a === 169 && b === 254) || // link-local, cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224 // multicast + reserved
    );
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    return v === "::" || v === "::1" || v.startsWith("fe80:") || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("ff") || v.startsWith("2001:db8");
  }
  return true;
}

export interface SafeUrlOptions {
  allowPrivate?: boolean;
  allowedProtocols?: string[];
}

export function parseSafeUrl(input: string, opts: SafeUrlOptions = {}): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw Errors.validation("That doesn't look like a valid URL.");
  }
  const protocols = opts.allowedProtocols ?? ["https:", "http:"];
  if (!protocols.includes(url.protocol)) throw Errors.validation(`Only ${protocols.map((p) => p.replace(":", "")).join(" and ")} URLs are allowed.`);
  if (url.username || url.password) throw Errors.validation("URLs can't contain a username or password.");
  if (!url.hostname) throw Errors.validation("The URL needs a host name.");
  if (!opts.allowPrivate) {
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (net.isIP(host) && isPrivateAddress(host)) throw Errors.validation("That address points to a private network and can't be used.");
    if (/^localhost$|\.localhost$|\.local$|\.internal$/i.test(host)) throw Errors.validation("That host name points to a private network and can't be used.");
  }
  return url;
}

function guardedLookup(allowPrivate: boolean) {
  return (hostname: string, options: dns.LookupOptions, callback: (err: NodeJS.ErrnoException | null, address?: string | dns.LookupAddress[], family?: number) => void) => {
    dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err);
      const list = addresses as dns.LookupAddress[];
      if (!allowPrivate && list.some((a) => isPrivateAddress(a.address))) {
        return callback(Object.assign(new Error("Blocked: the host resolves to a private network address."), { code: "ECONNREFUSED" }));
      }
      if (options.all) return callback(null, list);
      callback(null, list[0].address, list[0].family);
    });
  };
}

const agents = new Map<boolean, Agent>();
function agentFor(allowPrivate: boolean): Agent {
  let a = agents.get(allowPrivate);
  if (!a) {
    a = new Agent({ connect: { lookup: guardedLookup(allowPrivate) as never, timeout: 10_000 }, headersTimeout: 30_000, bodyTimeout: 0 });
    agents.set(allowPrivate, a);
  }
  return a;
}

/** One request, no redirects, destination validated at connect time. */
export async function safeFetch(input: string, init: RequestInit & SafeUrlOptions = {}) {
  const { allowPrivate, allowedProtocols, ...rest } = init;
  const url = parseSafeUrl(input, { allowPrivate, allowedProtocols });
  return undiciFetch(url, { ...rest, redirect: "manual", dispatcher: agentFor(!!allowPrivate) });
}

/** Follows at most `maxRedirects` redirects, validating each hop. */
export async function safeFetchFollow(input: string, init: RequestInit & SafeUrlOptions = {}, maxRedirects = 3) {
  let url = input;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const res = await safeFetch(url, init);
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = new URL(res.headers.get("location")!, url).toString();
      await res.body?.cancel().catch(() => undefined);
      continue;
    }
    return res;
  }
  throw Errors.validation(`The address redirected more than ${maxRedirects} times.`);
}
