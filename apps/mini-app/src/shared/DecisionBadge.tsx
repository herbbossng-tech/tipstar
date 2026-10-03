import { StatusBadge } from "./StatusBadge.js";
import { describeDecisionOutcome } from "./statusPresentation.js";

export function DecisionBadge({ outcome }: { readonly outcome: string }): JSX.Element {
  return <StatusBadge {...describeDecisionOutcome(outcome)} />;
}
