"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/primitives";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-3 py-20 text-center">
      <AlertTriangle className="size-8 text-danger" />
      <h1 className="text-lg font-semibold text-fg">Something went wrong on this page</h1>
      <p className="text-sm text-muted">The error has been logged. Your data is unaffected — no action was taken.{error.digest ? ` Reference: ${error.digest}` : ""}</p>
      <Button onClick={reset} variant="primary">
        <RotateCcw /> Try again
      </Button>
    </div>
  );
}
