"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/client-api";
import { cn } from "@/lib/cn";
import { Button, Input, Label, Select, Textarea } from "@/components/ui/primitives";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/overlays";

/** Inline select that PATCHes an entity field and refreshes server data. */
export function EntitySelect({ type, id, field, value, options, className }: { type: string; id: string; field: string; value: string; options: string[]; className?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [v, setV] = useState(value);
  return (
    <Select
      className={cn("h-8 text-xs", pending && "opacity-60", className)}
      value={v}
      aria-label={field}
      onChange={async (e) => {
        const next = e.target.value;
        setV(next);
        try {
          await apiFetch(`/api/entities/${type}/${id}`, { method: "PATCH", body: { [field]: next } });
          toast.success(`${field} → ${next.replace(/_/g, " ")}`);
          start(() => router.refresh());
        } catch (err) {
          setV(value);
          toast.error((err as Error).message);
        }
      }}
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {o.replace(/_/g, " ")}
        </option>
      ))}
    </Select>
  );
}

/** Generic action button hitting an entity PATCH (e.g. complete task, log contact). */
export function EntityAction({ type, id, body, label, icon, variant = "secondary", size = "sm", confirmText, success }: { type: string; id: string; body: Record<string, unknown>; label: string; icon?: React.ReactNode; variant?: "primary" | "secondary" | "ghost" | "outline"; size?: "sm" | "md" | "icon-sm"; confirmText?: string; success?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant={variant}
      size={size}
      disabled={busy}
      title={label}
      onClick={async () => {
        if (confirmText && !window.confirm(confirmText)) return;
        setBusy(true);
        try {
          await apiFetch(`/api/entities/${type}/${id}`, { method: "PATCH", body });
          toast.success(success ?? "Saved");
          router.refresh();
        } catch (e) {
          toast.error((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? <Loader2 className="animate-spin" /> : (icon ?? <Check />)}
      {size !== "icon-sm" && label}
    </Button>
  );
}

export function DeleteEntityButton({ type, id, label = "Delete", redirectTo }: { type: string; id: string; label?: string; redirectTo?: string }) {
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={async () => {
        if (!window.confirm(`Permanently delete this ${type}? This cannot be undone.`)) return;
        try {
          await apiFetch(`/api/entities/${type}/${id}`, { method: "DELETE" });
          toast.success("Deleted");
          if (redirectTo) router.push(redirectTo);
          else router.refresh();
        } catch (e) {
          toast.error((e as Error).message);
        }
      }}
    >
      <Trash2 /> {label}
    </Button>
  );
}

export interface FieldSpec {
  name: string;
  label: string;
  type?: "text" | "number" | "date" | "textarea" | "select" | "email";
  options?: { value: string; label: string }[];
  required?: boolean;
  placeholder?: string;
  defaultValue?: string;
}

/** Dialog form that POSTs to /api/entities/[type]. Numbers are coerced; empty fields omitted. */
export function CreateEntityDialog({ type, title, fields, trigger, extra }: { type: string; title: string; fields: FieldSpec[]; trigger?: React.ReactNode; extra?: Record<string, unknown> }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="primary">
            <Plus /> New {type}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent title={title}>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const body: Record<string, unknown> = { ...extra };
            for (const f of fields) {
              const v = String(fd.get(f.name) ?? "").trim();
              if (!v) continue;
              body[f.name] = f.type === "number" ? Number(v) : v;
            }
            setBusy(true);
            try {
              await apiFetch(`/api/entities/${type}`, { body });
              toast.success(`${title.replace(/^New /, "")} created`);
              setOpen(false);
              router.refresh();
            } catch (err) {
              toast.error((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {fields.map((f) => (
            <div key={f.name} className="space-y-1">
              <Label htmlFor={`f-${f.name}`}>{f.label}</Label>
              {f.type === "textarea" ? (
                <Textarea id={`f-${f.name}`} name={f.name} rows={3} placeholder={f.placeholder} required={f.required} defaultValue={f.defaultValue} />
              ) : f.type === "select" ? (
                <Select id={`f-${f.name}`} name={f.name} className="w-full" defaultValue={f.defaultValue}>
                  {!f.required && <option value="">—</option>}
                  {f.options?.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input id={`f-${f.name}`} name={f.name} type={f.type ?? "text"} step={f.type === "number" ? "any" : undefined} placeholder={f.placeholder} required={f.required} defaultValue={f.defaultValue} />
              )}
            </div>
          ))}
          <Button type="submit" variant="primary" className="w-full" disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Check />} Create
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
