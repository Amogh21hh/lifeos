"use client";

import * as React from "react";
import { Dialog as D, DropdownMenu as DM, Tabs as T, Tooltip as TT } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({ title, description, children, className, side }: { title: string; description?: string; children: React.ReactNode; className?: string; side?: "right" }) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] data-[state=open]:animate-fade-in" />
      <D.Content
        className={cn(
          "fixed z-50 border border-line bg-elev shadow-card focus:outline-none",
          side === "right"
            ? "inset-y-0 right-0 flex w-full max-w-lg flex-col overflow-y-auto border-y-0 border-r-0 data-[state=open]:animate-fade-in"
            : "top-1/2 left-1/2 max-h-[88vh] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl data-[state=open]:animate-fade-in",
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <D.Title className="text-base font-semibold text-fg">{title}</D.Title>
            {description ? <D.Description className="mt-0.5 text-sm text-muted">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
          </div>
          <D.Close className="rounded-md p-1 text-muted hover:bg-hover hover:text-fg" aria-label="Close">
            <X className="size-4" />
          </D.Close>
        </div>
        <div className="px-5 py-4">{children}</div>
      </D.Content>
    </D.Portal>
  );
}

export const DropdownMenu = DM.Root;
export const DropdownMenuTrigger = DM.Trigger;
export function DropdownMenuContent({ children, align = "end" }: { children: React.ReactNode; align?: "start" | "end" | "center" }) {
  return (
    <DM.Portal>
      <DM.Content align={align} sideOffset={6} className="z-50 min-w-48 rounded-xl border border-line bg-elev p-1 shadow-card data-[state=open]:animate-fade-in">
        {children}
      </DM.Content>
    </DM.Portal>
  );
}
export function DropdownMenuItem({ children, onSelect, className }: { children: React.ReactNode; onSelect?: () => void; className?: string }) {
  return (
    <DM.Item onSelect={onSelect} className={cn("flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-fg outline-none data-[highlighted]:bg-hover [&_svg]:size-4 [&_svg]:text-muted", className)}>
      {children}
    </DM.Item>
  );
}
export function DropdownMenuSeparator() {
  return <DM.Separator className="my-1 h-px bg-line" />;
}

export function Tabs({ value, onValueChange, defaultValue, children, className }: { value?: string; onValueChange?: (v: string) => void; defaultValue?: string; children: React.ReactNode; className?: string }) {
  return (
    <T.Root value={value} onValueChange={onValueChange} defaultValue={defaultValue} className={className}>
      {children}
    </T.Root>
  );
}
export function TabsList({ children, className }: { children: React.ReactNode; className?: string }) {
  return <T.List className={cn("inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-lg border border-line bg-sunken p-1", className)}>{children}</T.List>;
}
export function TabsTrigger({ value, children }: { value: string; children: React.ReactNode }) {
  return (
    <T.Trigger value={value} className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm whitespace-nowrap text-muted transition-colors hover:text-fg data-[state=active]:bg-elev data-[state=active]:text-fg data-[state=active]:shadow-card [&_svg]:size-3.5">
      {children}
    </T.Trigger>
  );
}
export function TabsContent({ value, children, className }: { value: string; children: React.ReactNode; className?: string }) {
  return (
    <T.Content value={value} className={cn("mt-4 focus:outline-none data-[state=active]:animate-fade-in", className)}>
      {children}
    </T.Content>
  );
}

export function Tooltip({ content, children, side = "top" }: { content: React.ReactNode; children: React.ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <TT.Provider delayDuration={250}>
      <TT.Root>
        <TT.Trigger asChild>{children}</TT.Trigger>
        <TT.Portal>
          <TT.Content side={side} sideOffset={6} className="z-50 max-w-xs rounded-lg border border-line bg-elev px-2.5 py-1.5 text-xs text-fg shadow-card data-[state=delayed-open]:animate-fade-in">
            {content}
          </TT.Content>
        </TT.Portal>
      </TT.Root>
    </TT.Provider>
  );
}
