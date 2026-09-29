"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { api, ApiClientError } from "@/lib/api-client";

/**
 * Tells the server this page was opened, once. That is what counts against a link's view limit and feeds the
 * owner's analytics (counts only, nothing about the visitor). A used-up limit refreshes the page into "gone".
 */
export function ViewBeacon({ token }: { token: string }) {
  const router = useRouter();
  useEffect(() => {
    const key = `cairn:view:${token}`;
    try {
      // React strict mode and back/forward navigation must not count one visit twice.
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      /* storage blocked: count it anyway */
    }
    api(`/api/v1/public/shares/${token}/view`, { method: "POST", body: {} }).catch((err) => {
      if (err instanceof ApiClientError && err.status === 410) router.refresh();
    });
  }, [token, router]);
  return null;
}
