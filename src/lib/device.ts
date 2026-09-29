/** Friendly "Chrome on Windows" label from a User-Agent string (kept coarse on purpose: no fingerprinting). */
export function deviceLabelFrom(ua: string | null | undefined): { label: string; mobile: boolean } {
  if (!ua) return { label: "Unknown device", mobile: false };
  const mobile = /Mobi|Android|iPhone|iPad/i.test(ua);
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /curl|wget|python|node|axios|okhttp|Go-http/i.test(ua) ? "Command line / script" : "Browser";
  const os = /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Linux/.test(ua) ? "Linux" : "";
  return { label: os && !browser.includes("script") ? `${browser} on ${os}` : browser, mobile };
}
