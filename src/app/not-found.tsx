import Link from "next/link";
import { Compass } from "lucide-react";
import { ButtonLink } from "@/components/ui/Button";
import { Logo } from "@/components/ui/Logo";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-bg px-6 text-center">
      <Link href="/" className="mb-10 text-fg" aria-label="Cairn home">
        <Logo />
      </Link>
      <div className="mb-4 flex size-12 items-center justify-center rounded-xl border border-line bg-surface-2 text-subtle">
        <Compass className="size-5" aria-hidden />
      </div>
      <h1 className="text-xl font-semibold tracking-tight">Page not found</h1>
      <p className="mt-1 max-w-sm text-[13px] text-muted">The page you&apos;re looking for doesn&apos;t exist, or you don&apos;t have access to it.</p>
      <div className="mt-5 flex gap-2">
        <ButtonLink href="/" variant="primary">
          Go to the start
        </ButtonLink>
        <ButtonLink href="/dashboard">Dashboard</ButtonLink>
      </div>
    </div>
  );
}
