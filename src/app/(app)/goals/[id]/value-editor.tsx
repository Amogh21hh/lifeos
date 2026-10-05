"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { apiFetch } from "@/lib/client-api";
import { Button, Input } from "@/components/ui/primitives";

export function GoalValueEditor({ id, current }: { id: string; current: number | null }) {
  const [v, setV] = useState(current?.toString() ?? "");
  const router = useRouter();
  return (
    <form
      className="mt-3 flex items-center gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await apiFetch(`/api/entities/goal/${id}`, { method: "PATCH", body: { currentValue: Number(v) } });
          toast.success("Progress updated");
          router.refresh();
        } catch (err) {
          toast.error((err as Error).message);
        }
      }}
    >
      <Input type="number" step="any" value={v} onChange={(e) => setV(e.target.value)} className="h-8 w-32" aria-label="Current value" />
      <Button size="sm" type="submit">
        Update progress
      </Button>
    </form>
  );
}
