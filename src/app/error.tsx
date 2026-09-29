"use client";

import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";

// Next.js only shows the digest in production; the message itself is never displayed, so internals can't leak.
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-xl border border-danger/30 bg-danger-soft text-danger">
        <TriangleAlert className="size-5" aria-hidden />
      </div>
      <h1 className="text-xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="mt-1 max-w-sm text-[13px] text-muted">We couldn&apos;t load this page. Try again, and if it keeps happening let an administrator know{error.digest ? ` (reference ${error.digest})` : ""}.</p>
      <div className="mt-5 flex gap-2">
        <Button variant="primary" onClick={reset}>
          Try again
        </Button>
        <Link href="/" className="inline-flex h-9 items-center rounded-md border border-line-strong px-3.5 text-sm font-medium hover:bg-surface-2">
          Go home
        </Link>
      </div>
    </div>
  );
}
