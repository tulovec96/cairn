"use client";

import { CopyButton } from "@/components/ui/CopyButton";

export function CopyShareClient({ token }: { token: string }) {
  return <CopyButton value={() => `${window.location.origin}/d/${token}`} label="Copy link" size="md" />;
}
