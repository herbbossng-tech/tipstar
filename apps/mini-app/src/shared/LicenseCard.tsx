import type { UserProfile } from "../auth/types.js";
import { EmptyState } from "./EmptyState.js";
import { StatusBadge } from "./StatusBadge.js";
import { describeLicenseStatus } from "./statusPresentation.js";
import { formatDate } from "./format.js";

/** Real license summary from `/me` (Section 09 §10/§29). Never renders a raw license key or any other credential-shaped value — `UserProfile["license"]` carries none to begin with. */
export function LicenseCard({ license }: { readonly license: UserProfile["license"] }): JSX.Element {
  if (license === null) {
    return <EmptyState title="No active license" message="You don't currently have an active or trial license." />;
  }

  return (
    <div className="card">
      <div className="card__row">
        <span className="card__label">Plan</span>
        <span>{license.plan}</span>
      </div>
      <div className="card__row">
        <span className="card__label">Status</span>
        <StatusBadge {...describeLicenseStatus(license.status)} />
      </div>
      <div className="card__row">
        <span className="card__label">Expires</span>
        <span>{formatDate(license.expiresAt, "No expiry")}</span>
      </div>
    </div>
  );
}
