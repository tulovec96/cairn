import { describe, expect, it } from "vitest";
import { contentDisposition, safeExtension, sanitizeFilename, sanitizeFolderName, uniqueName } from "@/server/security/filenames";
import { isPrivateAddress, parseSafeUrl } from "@/server/security/ssrf";
import { sanitizeSvg } from "@/server/security/svg";

describe("sanitizeFilename", () => {
  it("keeps ordinary names", () => {
    expect(sanitizeFilename("report Q3.pdf")).toBe("report Q3.pdf");
  });
  it("keeps only the last path segment, whichever separator was used", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("C:\\Users\\me\\secret.txt")).toBe("secret.txt");
  });
  it("removes bidi overrides that spoof extensions", () => {
    const spoof = "invoice\u202Egpj.exe";
    expect(sanitizeFilename(spoof)).toBe("invoicegpj.exe");
  });
  it("removes control characters and replaces reserved punctuation", () => {
    expect(sanitizeFilename("a\u0000b\u001fc<>:\"|?*.txt")).toBe("abc_______.txt");
  });
  it("protects Windows device names", () => {
    expect(sanitizeFilename("CON.txt")).toBe("_CON.txt");
    expect(sanitizeFilename("nul")).toBe("_nul");
  });
  it("strips leading dots and trailing dots/spaces", () => {
    expect(sanitizeFilename(".hidden")).toBe("hidden");
    expect(sanitizeFilename("name. . ")).toBe("name");
  });
  it("falls back when nothing is left", () => {
    expect(sanitizeFilename("..")).toBe("file");
    expect(sanitizeFilename("///")).toBe("file");
    expect(sanitizeFilename("", "unnamed")).toBe("unnamed");
  });
  it("limits length in bytes without splitting characters and keeps the extension", () => {
    const name = sanitizeFilename(`${"é".repeat(400)}.pdf`);
    expect(Buffer.byteLength(name)).toBeLessThanOrEqual(232);
    expect(name.endsWith(".pdf")).toBe(true);
    expect(name).not.toContain("\uFFFD");
  });
});

describe("sanitizeFolderName", () => {
  it("replaces separators instead of splitting", () => {
    expect(sanitizeFolderName("a/b\\c")).toBe("a_b_c");
  });
  it("rejects dot names", () => {
    expect(sanitizeFolderName("..")).toBe("");
    expect(sanitizeFolderName(".")).toBe("");
  });
});

describe("uniqueName", () => {
  it("returns the name when free", () => {
    expect(uniqueName("a.txt", new Set())).toBe("a.txt");
  });
  it("adds a counter before the extension and compares case-insensitively", () => {
    expect(uniqueName("A.txt", new Set(["a.txt"]))).toBe("A (1).txt");
    expect(uniqueName("a.txt", new Set(["a.txt", "a (1).txt"]))).toBe("a (2).txt");
  });
  it("handles names without an extension", () => {
    expect(uniqueName("notes", new Set(["notes"]))).toBe("notes (1)");
  });
});

describe("safeExtension", () => {
  it("lower-cases the extension", () => {
    expect(safeExtension("Photo.JPG")).toBe("jpg");
  });
});

describe("contentDisposition", () => {
  it("cannot be used for header injection", () => {
    const v = contentDisposition("attachment", 'x"; filename="evil.exe\r\nSet-Cookie: a=b');
    expect(v).not.toMatch(/[\r\n]/);
    expect(v.startsWith("attachment; filename=")).toBe(true);
  });
  it("encodes non-ASCII names for filename*", () => {
    const v = contentDisposition("inline", "résumé.pdf");
    expect(v).toContain("filename*=UTF-8''r%C3%A9sum%C3%A9.pdf");
    expect(v).toContain('filename="r_sum_.pdf"');
  });
});

describe("isPrivateAddress", () => {
  it.each(["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fe80::1", "fd00::1", "::ffff:10.0.0.1"])("blocks %s", (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });
  it.each(["8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700:4700::1111"])("allows %s", (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });
  it("treats anything that isn't an IP as unsafe", () => {
    expect(isPrivateAddress("not-an-ip")).toBe(true);
  });
});

describe("parseSafeUrl", () => {
  it("accepts public https and http URLs", () => {
    expect(parseSafeUrl("https://example.com/a.zip").hostname).toBe("example.com");
    expect(parseSafeUrl("http://example.com").protocol).toBe("http:");
  });
  it.each(["ftp://example.com/x", "file:///etc/passwd", "javascript:alert(1)", "gopher://example.com"])("rejects protocol in %s", (u) => {
    expect(() => parseSafeUrl(u)).toThrow();
  });
  it("rejects embedded credentials", () => {
    expect(() => parseSafeUrl("https://user:pw@example.com/")).toThrow();
  });
  it.each(["http://localhost/", "http://127.0.0.1/", "http://[::1]/", "http://169.254.169.254/latest/meta-data", "http://10.0.0.5:8080/", "http://printer.local/", "http://service.internal/", "http://app.localhost/"])("rejects private target %s", (u) => {
    expect(() => parseSafeUrl(u)).toThrow();
  });
  it("allows private targets only when explicitly permitted", () => {
    expect(parseSafeUrl("http://127.0.0.1:9000/hook", { allowPrivate: true }).port).toBe("9000");
  });
  it("rejects garbage", () => {
    expect(() => parseSafeUrl("not a url")).toThrow();
  });
});

describe("sanitizeSvg", () => {
  const clean = (svg: string) => sanitizeSvg(svg).toLowerCase();
  it("keeps harmless shapes", () => {
    const out = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="5" height="5" fill="red"/></svg>');
    expect(out).toContain("<rect");
    expect(out).toContain('fill="red"');
  });
  it("removes scripts and foreignObject", () => {
    const out = clean('<svg><script>alert(1)</script><foreignObject><div onclick="x()">hi</div></foreignObject><circle r="1"/></svg>');
    expect(out).not.toContain("script");
    expect(out).not.toContain("foreignobject");
    expect(out).toContain("<circle");
  });
  it("removes event handlers", () => {
    const out = clean('<svg><rect onload="alert(1)" onclick="alert(2)" width="1" height="1"/></svg>');
    expect(out).not.toContain("onload");
    expect(out).not.toContain("onclick");
    expect(out).not.toContain("alert");
  });
  it("removes javascript: and external references", () => {
    const out = clean('<svg><a href="javascript:alert(1)"><rect width="1" height="1"/></a><image href="https://evil.example/x.png"/><use xlink:href="https://evil.example/s.svg#a"/></svg>');
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain("evil.example");
  });
  it("removes DOCTYPE/entity declarations and processing instructions", () => {
    const out = clean('<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg><text>&x;</text></svg>');
    expect(out).not.toContain("doctype");
    expect(out).not.toContain("entity");
    expect(out).not.toContain("file://");
  });
  it("neutralizes CSS that fetches resources", () => {
    const out = clean('<svg><style>@import url(https://evil.example/a.css); rect{fill:url(https://evil.example/x)}</style><rect/></svg>');
    expect(out).not.toContain("evil.example");
    expect(out).not.toContain("@import");
  });
});
