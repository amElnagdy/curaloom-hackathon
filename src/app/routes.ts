// The route registry: the single source for the rail nav and the breadcrumb (#15).
// Pages outside the nav, such as the /dev/bidi test page, are not listed here.

import {
  BookOpen,
  ChartColumn,
  ClipboardCheck,
  type LucideIcon,
  MapIcon,
  MessageCircle,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
} from "lucide-react";

export type RouteGroup = "learn" | "account";

export type AppRoute = {
  id: string;
  path: `/${string}`;
  // Arabic, shown in the nav, the tooltip and the breadcrumb.
  label: string;
  icon: LucideIcon;
  group: RouteGroup;
};

export const ROUTES = [
  { id: "intake", path: "/intake", label: "المقابلة", icon: MessageCircle, group: "learn" },
  { id: "plan", path: "/plan", label: "الخطة", icon: MapIcon, group: "learn" },
  { id: "lesson", path: "/lesson", label: "الدرس", icon: BookOpen, group: "learn" },
  { id: "quiz", path: "/quiz", label: "الاختبار", icon: ClipboardCheck, group: "learn" },
  { id: "progress", path: "/progress", label: "التقدّم", icon: ChartColumn, group: "learn" },
  { id: "coach", path: "/coach", label: "رسائل المدرب", icon: Smartphone, group: "learn" },
  { id: "consent", path: "/consent", label: "الموافقة", icon: ShieldCheck, group: "account" },
  {
    id: "settings",
    path: "/settings",
    label: "الإعدادات",
    icon: SlidersHorizontal,
    group: "account",
  },
] as const satisfies readonly AppRoute[];

export type RouteId = (typeof ROUTES)[number]["id"];

// The nav route a pathname belongs to: "/lesson/L1" is under "/lesson".
export function routeForPath(pathname: string): AppRoute | undefined {
  return ROUTES.find((r) => pathname === r.path || pathname.startsWith(`${r.path}/`));
}
