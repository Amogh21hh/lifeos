"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/primitives";

export function RefreshButton({ label = "Refresh" }: { label?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button onClick={() => start(() => router.refresh())} disabled={pending}>
      {pending ? <Loader2 className="animate-spin" /> : <RefreshCw />} {label}
    </Button>
  );
}
