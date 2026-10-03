import {
  Activity,
  Bot,
  Briefcase,
  CalendarRange,
  FileText,
  FlaskConical,
  FolderKanban,
  Home,
  Library,
  type LucideIcon,
  Radar,
  Scale,
  ScanSearch,
  Settings,
  Target,
  TerminalSquare,
  Users,
  Wallet,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  shortcut?: string;
}

export const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: "Intelligence",
    items: [
      { href: "/", label: "Home", icon: Home, shortcut: "g h" },
      { href: "/radar", label: "LIFEOS Radar", icon: Radar, shortcut: "g r" },
      { href: "/missing", label: "What am I missing?", icon: ScanSearch, shortcut: "g m" },
      { href: "/command", label: "Command Center", icon: TerminalSquare, shortcut: "g c" },
    ],
  },
  {
    group: "World",
    items: [
      { href: "/opportunities", label: "Opportunities", icon: Briefcase, shortcut: "g o" },
      { href: "/projects", label: "Projects", icon: FolderKanban, shortcut: "g p" },
      { href: "/decisions", label: "Decisions", icon: Scale, shortcut: "g d" },
      { href: "/goals", label: "Goals", icon: Target, shortcut: "g g" },
      { href: "/people", label: "People", icon: Users, shortcut: "g u" },
      { href: "/documents", label: "Documents", icon: FileText, shortcut: "g f" },
      { href: "/finance", label: "Finance", icon: Wallet, shortcut: "g $" },
      { href: "/knowledge", label: "Knowledge", icon: Library, shortcut: "g k" },
    ],
  },
  {
    group: "Analysis",
    items: [
      { href: "/simulate", label: "Simulator", icon: FlaskConical, shortcut: "g s" },
      { href: "/weekly", label: "Weekly report", icon: CalendarRange, shortcut: "g w" },
      { href: "/activity", label: "AI activity", icon: Bot, shortcut: "g a" },
    ],
  },
  { group: "System", items: [{ href: "/settings", label: "Settings", icon: Settings }] },
];

export const MOBILE_TABS: NavItem[] = [
  { href: "/", label: "Home", icon: Home },
  { href: "/radar", label: "Radar", icon: Radar },
  { href: "/command", label: "Command", icon: TerminalSquare },
  { href: "/opportunities", label: "Opps", icon: Briefcase },
  { href: "/activity", label: "Activity", icon: Activity },
];
