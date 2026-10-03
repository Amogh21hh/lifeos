"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Command } from "cmdk";
import { Dialog as D } from "radix-ui";
import { Bell, CornerDownLeft, Keyboard, LogOut, Menu, Moon, Search, Sparkles, Sun, TerminalSquare, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { apiFetch } from "@/lib/client-api";
import { Kbd } from "@/components/ui/primitives";
import { Dialog, DialogContent, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/overlays";
import { MOBILE_TABS, NAV } from "./nav";
import { useTheme } from "./theme";

const QUICK_COMMANDS = [
  "What should I focus on this week?",
  "What am I missing?",
  "Show me what changed since last week.",
  "Prepare my weekly review.",
  "Find unfinished projects.",
  "I want to increase my income.",
  "Find missing information.",
  "What happens if I work 10 extra hours this month?",
];

function Logo({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2.5" aria-label="LIFEOS home">
      <span className="relative flex size-7 items-center justify-center rounded-lg border border-accent/40 bg-accent-soft">
        <span className="absolute size-2 rounded-full bg-accent shadow-[0_0_12px_var(--accent)]" />
        <span className="absolute size-5 rounded-full border border-accent/30" />
      </span>
      {!collapsed && <span className="font-mono text-sm font-semibold tracking-[0.25em] text-fg">LIFEOS</span>}
    </Link>
  );
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const path = usePathname();
  return (
    <nav className="space-y-5">
      {NAV.map((g) => (
        <div key={g.group}>
          <div className="mb-1.5 px-2.5 font-mono text-[10px] tracking-[0.2em] text-faint uppercase">{g.group}</div>
          <ul className="space-y-0.5">
            {g.items.map((it) => {
              const active = it.href === "/" ? path === "/" : path.startsWith(it.href);
              return (
                <li key={it.href}>
                  <Link
                    href={it.href}
                    onClick={onNavigate}
                    className={cn(
                      "group flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors",
                      active ? "bg-accent-soft text-fg shadow-[inset_2px_0_0_var(--accent)]" : "text-muted hover:bg-hover hover:text-fg",
                    )}
                  >
                    <it.icon className={cn("size-4 shrink-0", active ? "text-accent" : "text-faint group-hover:text-muted")} />
                    <span className="truncate">{it.label}</span>
                    {it.shortcut && <span className="ml-auto hidden font-mono text-[10px] text-faint opacity-0 transition-opacity group-hover:opacity-100 lg:inline">{it.shortcut}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function AppShell({ user, pendingApprovals, aiEngine, children }: { user: { name: string; email: string; isDemo: boolean }; pendingApprovals: number; aiEngine: string; children: React.ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [query, setQuery] = useState("");
  const router = useRouter();
  const { theme, toggle } = useTheme();
  const seq = useRef<{ key: string; at: number } | null>(null);

  const go = useCallback(
    (href: string) => {
      setPaletteOpen(false);
      setQuery("");
      router.push(href);
    },
    [router],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const typing = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "?") {
        setHelpOpen(true);
        return;
      }
      if (e.key === "/") {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }
      const now = Date.now();
      if (seq.current?.key === "g" && now - seq.current.at < 1200) {
        const item = NAV.flatMap((g) => g.items).find((i) => i.shortcut === `g ${e.key}`);
        seq.current = null;
        if (item) {
          e.preventDefault();
          router.push(item.href);
        }
        return;
      }
      if (e.key === "g") seq.current = { key: "g", at: now };
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  async function signOut() {
    await apiFetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    window.location.href = "/login";
  }

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line bg-sunken/60 lg:flex">
        <div className="flex h-14 items-center px-4">
          <Logo />
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-4">
          <NavLinks />
        </div>
        <div className="border-t border-line p-3">
          <div className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] text-faint">
            <span className={cn("size-1.5 rounded-full", aiEngine === "local" ? "bg-signal" : "bg-success")} />
            {aiEngine === "local" ? "Local reasoning engine" : `AI: ${aiEngine}`}
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-bg/80 px-3 backdrop-blur-md sm:px-5">
          <button className="rounded-lg p-2 text-muted hover:bg-hover lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
            <Menu className="size-5" />
          </button>
          <div className="lg:hidden">
            <Logo collapsed />
          </div>
          <button
            onClick={() => setPaletteOpen(true)}
            className="mx-auto flex h-9 w-full max-w-md items-center gap-2 rounded-lg border border-line bg-elev px-3 text-sm text-faint transition-colors hover:border-line-strong hover:text-muted"
          >
            <Search className="size-4" />
            <span className="truncate">Ask or jump anywhere…</span>
            <span className="ml-auto hidden items-center gap-1 sm:flex">
              <Kbd>Ctrl</Kbd>
              <Kbd>K</Kbd>
            </span>
          </button>
          <Link href="/activity" className="relative rounded-lg p-2 text-muted hover:bg-hover hover:text-fg" aria-label={`${pendingApprovals} actions awaiting approval`}>
            <Bell className="size-4.5" />
            {pendingApprovals > 0 && <span className="absolute top-1 right-1 flex size-4 items-center justify-center rounded-full bg-signal font-mono text-[9px] font-bold text-black">{pendingApprovals}</span>}
          </Link>
          <button className="rounded-lg p-2 text-muted hover:bg-hover hover:text-fg" onClick={toggle} aria-label="Toggle theme">
            <Sun className="hidden size-4.5 dark:block" />
            <Moon className="size-4.5 dark:hidden" />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger className="flex size-8 items-center justify-center rounded-full border border-line bg-elev font-mono text-xs font-semibold text-fg" aria-label="Account menu">
              {user.name.slice(0, 1).toUpperCase()}
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <div className="px-2.5 py-2">
                <div className="text-sm font-medium text-fg">{user.name}</div>
                <div className="text-xs text-faint">{user.email}</div>
                {user.isDemo && <div className="mt-1 text-[11px] text-signal">Demo workspace — fictional data</div>}
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setHelpOpen(true)}>
                <Keyboard /> Keyboard shortcuts
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => router.push("/settings")}>
                <Sparkles /> Settings
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={signOut}>
                <LogOut /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        <main className="bg-grid flex-1 px-4 pt-6 pb-24 sm:px-6 lg:px-10 lg:pb-12">{children}</main>
      </div>

      {/* Mobile bottom tabs */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-elev/95 backdrop-blur-md lg:hidden" aria-label="Primary">
        {MOBILE_TABS.map((t) => (
          <Link key={t.href} href={t.href} className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] text-muted active:text-accent">
            <t.icon className="size-5" />
            {t.label}
          </Link>
        ))}
      </nav>

      {/* Mobile drawer */}
      <D.Root open={mobileOpen} onOpenChange={setMobileOpen}>
        <D.Portal>
          <D.Overlay className="fixed inset-0 z-50 bg-black/50 lg:hidden" />
          <D.Content className="fixed inset-y-0 left-0 z-50 w-72 overflow-y-auto border-r border-line bg-elev p-3 lg:hidden">
            <D.Title className="sr-only">Navigation</D.Title>
            <D.Description className="sr-only">Main navigation</D.Description>
            <div className="mb-4 flex items-center justify-between px-1">
              <Logo />
              <D.Close className="rounded-md p-1.5 text-muted hover:bg-hover" aria-label="Close navigation">
                <X className="size-4" />
              </D.Close>
            </div>
            <NavLinks onNavigate={() => setMobileOpen(false)} />
          </D.Content>
        </D.Portal>
      </D.Root>

      {/* Command palette */}
      <D.Root open={paletteOpen} onOpenChange={setPaletteOpen}>
        <D.Portal>
          <D.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px]" />
          <D.Content className="fixed top-[12vh] left-1/2 z-50 w-[calc(100vw-1.5rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-2xl border border-line bg-elev shadow-card">
            <D.Title className="sr-only">Command palette</D.Title>
            <D.Description className="sr-only">Search, navigate, or ask LIFEOS</D.Description>
            <Command loop className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:tracking-[0.2em] [&_[cmdk-group-heading]]:text-faint [&_[cmdk-group-heading]]:uppercase">
              <div className="flex items-center gap-2 border-b border-line px-4">
                <TerminalSquare className="size-4 text-accent" />
                <Command.Input value={query} onValueChange={setQuery} placeholder="Ask LIFEOS anything, or jump to a page…" className="h-12 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-faint" />
              </div>
              <Command.List className="max-h-[60vh] overflow-y-auto p-1.5">
                <Command.Empty className="px-3 py-6 text-center text-sm text-muted">Press Enter to ask the Command Center.</Command.Empty>
                {query.trim().length > 1 && (
                  <Command.Group heading="Ask">
                    <PaletteItem value={`ask ${query}`} onSelect={() => go(`/command?q=${encodeURIComponent(query)}`)}>
                      <Sparkles className="text-accent" /> Ask LIFEOS: <span className="truncate text-fg">“{query}”</span>
                      <CornerDownLeft className="ml-auto size-3.5 text-faint" />
                    </PaletteItem>
                    <PaletteItem value={`search ${query}`} onSelect={() => go(`/knowledge?q=${encodeURIComponent(query)}`)}>
                      <Search /> Search everything for <span className="truncate text-fg">“{query}”</span>
                    </PaletteItem>
                  </Command.Group>
                )}
                <Command.Group heading="Commands">
                  {QUICK_COMMANDS.map((c) => (
                    <PaletteItem key={c} value={c} onSelect={() => go(`/command?q=${encodeURIComponent(c)}`)}>
                      <TerminalSquare /> {c}
                    </PaletteItem>
                  ))}
                </Command.Group>
                <Command.Group heading="Go to">
                  {NAV.flatMap((g) => g.items).map((it) => (
                    <PaletteItem key={it.href} value={`go ${it.label}`} onSelect={() => go(it.href)}>
                      <it.icon /> {it.label}
                      {it.shortcut && <span className="ml-auto font-mono text-[10px] text-faint">{it.shortcut}</span>}
                    </PaletteItem>
                  ))}
                </Command.Group>
                <Command.Group heading="Preferences">
                  <PaletteItem value="toggle theme" onSelect={toggle}>
                    {theme === "dark" ? <Sun /> : <Moon />} Toggle {theme === "dark" ? "light" : "dark"} mode
                  </PaletteItem>
                </Command.Group>
              </Command.List>
            </Command>
          </D.Content>
        </D.Portal>
      </D.Root>

      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent title="Keyboard shortcuts">
          <ul className="space-y-2 text-sm">
            {[
              ["Ctrl / ⌘ + K", "Command palette"],
              ["/", "Command palette"],
              ["?", "This help"],
              ...NAV.flatMap((g) => g.items)
                .filter((i) => i.shortcut)
                .map((i) => [i.shortcut!, i.label]),
            ].map(([k, label]) => (
              <li key={k} className="flex items-center justify-between">
                <span className="text-muted">{label}</span>
                <span className="flex gap-1">
                  {k.split(" ").map((p, i) => (
                    <Kbd key={i}>{p}</Kbd>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PaletteItem({ children, value, onSelect }: { children: React.ReactNode; value: string; onSelect: () => void }) {
  return (
    <Command.Item value={value} onSelect={onSelect} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted data-[selected=true]:bg-hover data-[selected=true]:text-fg [&_svg]:size-4 [&_svg]:shrink-0">
      {children}
    </Command.Item>
  );
}
