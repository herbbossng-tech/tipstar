/**
 * Central navigation registry (Section 20). Adding a future module (AI
 * Chat, Agent dashboards, Favorites, Notifications, Premium) means adding
 * one entry here plus its page component — nothing else needs to change.
 */
export interface NavItem {
  readonly path: string;
  readonly label: string;
  readonly icon: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { path: "/", label: "Home", icon: "home" },
  { path: "/picks", label: "Picks", icon: "target" },
  { path: "/matches", label: "Matches", icon: "calendar" },
  { path: "/performance", label: "Performance", icon: "chart" },
  { path: "/account", label: "Account", icon: "user" },
];
