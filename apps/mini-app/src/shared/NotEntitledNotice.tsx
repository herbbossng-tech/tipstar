import { EmptyState } from "./EmptyState.js";

/** Shown when `/me`'s own entitlement list already says a feature is off — the UI hides/disables for UX only (Section 09 §30: "UI gating is NOT authorization"); the backend independently enforces the same check on every request regardless of what this component renders. */
export function NotEntitledNotice({ featureLabel }: { readonly featureLabel: string }): JSX.Element {
  return <EmptyState title={`${featureLabel} not included`} message="This feature is not included in your current plan." />;
}
