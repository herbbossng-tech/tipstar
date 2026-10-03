export interface NavItem {
  readonly path: string;
  readonly label: string;
}

/**
 * The six primary areas (Section 09 §4/§7/§42). Always visible — the
 * backend independently enforces entitlement on every request regardless
 * of what this list renders (§30: "UI gating is NOT authorization"), so
 * hiding an item here would only be a cosmetic convenience, never a
 * security boundary. Each page's own content honestly reports "not
 * included in your plan" when the caller lacks the entitlement.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { path: "/", label: "Home" },
  { path: "/football", label: "Football" },
  { path: "/tickets", label: "Tickets" },
  { path: "/aviator", label: "Aviator" },
  { path: "/performance", label: "Performance" },
  { path: "/account", label: "Account" },
];
