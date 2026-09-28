export interface NavItem {
  readonly path: string;
  readonly label: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { path: "/", label: "Dashboard" },
  { path: "/football", label: "Football" },
  { path: "/aviator", label: "Aviator" },
  { path: "/settings", label: "Settings" },
];
