import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { ApiError } from "./errors";
import { SESSION_COOKIE, WORKSPACE_COOKIE, clientIp } from "./http";
import { resolveCredentials, type Actor } from "./services/actor";

export const THEME_COOKIE = "cairn_theme";
export const SIDEBAR_COOKIE = "cairn_sidebar";

/** Who is viewing this page? Cookie credentials only; no CSRF concern because pages never mutate. */
export const getPageActor = cache(async (): Promise<Actor | null> => {
  const store = await cookies();
  try {
    const { actor } = await resolveCredentials({
      sessionToken: store.get(SESSION_COOKIE)?.value,
      workspaceCookie: store.get(WORKSPACE_COOKIE)?.value,
    });
    return actor;
  } catch (err) {
    if (err instanceof ApiError) return null; // e.g. suspended account: treat as signed out
    throw err;
  }
});

/** A minimal Request carrying the visitor's cookies and network headers, for service functions that read them (share unlock, IP rules). */
export async function pageRequest(): Promise<Request> {
  const h = await headers();
  const forward: Record<string, string> = { cookie: h.get("cookie") ?? "" };
  for (const name of ["x-forwarded-for", "x-cairn-peer"]) {
    const v = h.get(name);
    if (v) forward[name] = v;
  }
  return new Request("http://internal.invalid/", { headers: forward });
}

/** The visitor's address as the server sees it (same rules as the API: trusted proxy count, peer address). */
export async function pageIp(): Promise<string> {
  return clientIp(await pageRequest());
}

export async function currentPath(): Promise<string> {
  return (await headers()).get("x-pathname") ?? "/";
}

export async function requirePageUser(): Promise<Actor> {
  const actor = await getPageActor();
  if (!actor) {
    const path = await currentPath();
    redirect(`/login?next=${encodeURIComponent(path)}`);
  }
  return actor;
}

export async function requirePageAdmin(): Promise<Actor> {
  const actor = await requirePageUser();
  if (actor.user.role !== "admin") notFound();
  return actor;
}

export async function getSidebarCollapsed(): Promise<boolean> {
  return (await cookies()).get(SIDEBAR_COOKIE)?.value === "1";
}

export async function getThemePreference(): Promise<"light" | "dark" | undefined> {
  const v = (await cookies()).get(THEME_COOKIE)?.value;
  return v === "light" || v === "dark" ? v : undefined;
}
