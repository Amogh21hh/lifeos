import Link from "next/link";
import {
  Activity,
  Bookmark,
  Brain,
  Briefcase,
  Building2,
  CalendarClock,
  CheckSquare,
  CircleDollarSign,
  FileText,
  FolderKanban,
  GraduationCap,
  Handshake,
  Lightbulb,
  type LucideIcon,
  MessageSquare,
  Scale,
  Sparkles,
  StickyNote,
  Target,
  User,
  Wallet,
} from "lucide-react";
import type { EntityRef, EntityType } from "@/lib/types";
import { cn } from "@/lib/cn";

export const ENTITY_META: Record<EntityType | "potential" | "admin" | "integration", { icon: LucideIcon; label: string; tone: string }> = {
  goal: { icon: Target, label: "Goal", tone: "text-signal" },
  project: { icon: FolderKanban, label: "Project", tone: "text-accent" },
  task: { icon: CheckSquare, label: "Task", tone: "text-muted" },
  person: { icon: User, label: "Person", tone: "text-p-user" },
  company: { icon: Building2, label: "Company", tone: "text-muted" },
  opportunity: { icon: Briefcase, label: "Opportunity", tone: "text-success" },
  application: { icon: Briefcase, label: "Application", tone: "text-success" },
  document: { icon: FileText, label: "Document", tone: "text-p-assumption" },
  skill: { icon: GraduationCap, label: "Skill", tone: "text-p-estimate" },
  course: { icon: GraduationCap, label: "Course", tone: "text-p-estimate" },
  credential: { icon: Bookmark, label: "Credential", tone: "text-p-estimate" },
  transaction: { icon: CircleDollarSign, label: "Transaction", tone: "text-muted" },
  account: { icon: Wallet, label: "Account", tone: "text-muted" },
  asset: { icon: Wallet, label: "Asset", tone: "text-muted" },
  event: { icon: CalendarClock, label: "Event", tone: "text-p-user" },
  commitment: { icon: Handshake, label: "Commitment", tone: "text-danger" },
  habit: { icon: Activity, label: "Habit", tone: "text-muted" },
  idea: { icon: Lightbulb, label: "Idea", tone: "text-signal" },
  note: { icon: StickyNote, label: "Note", tone: "text-muted" },
  message: { icon: MessageSquare, label: "Message", tone: "text-p-user" },
  decision: { icon: Scale, label: "Decision", tone: "text-p-ai" },
  memory: { icon: Brain, label: "Memory", tone: "text-p-ai" },
  user: { icon: User, label: "You", tone: "text-accent" },
  potential: { icon: Sparkles, label: "Potential", tone: "text-signal" },
  admin: { icon: Activity, label: "Admin", tone: "text-muted" },
  integration: { icon: Activity, label: "Integration", tone: "text-muted" },
};

export function entityHref(ref: { type: string; id: string }) {
  return `/e/${ref.type}/${ref.id}`;
}

export function EntityIcon({ type, className }: { type: string; className?: string }) {
  const meta = ENTITY_META[type as EntityType] ?? ENTITY_META.note;
  const Icon = meta.icon;
  return <Icon className={cn("size-3.5 shrink-0", meta.tone, className)} aria-hidden />;
}

export function EntityLink({ entity, className, showType = false }: { entity: EntityRef | { type: string; id: string; label: string }; className?: string; showType?: boolean }) {
  if (!entity.id) return <span className={cn("inline-flex items-center gap-1", className)}>{entity.label}</span>;
  return (
    <Link href={entityHref(entity)} className={cn("group inline-flex max-w-full items-center gap-1.5 text-fg hover:text-accent", className)}>
      <EntityIcon type={entity.type} />
      <span className="truncate underline-offset-2 group-hover:underline">{entity.label}</span>
      {showType && <span className="text-[10px] tracking-wide text-faint uppercase">{ENTITY_META[entity.type as EntityType]?.label}</span>}
    </Link>
  );
}
