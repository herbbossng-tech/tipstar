import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { bootstrapOwner } from "../auth/authApi.js";
import { useAuthIdentity } from "../auth/AuthContext.js";
import { useProfile } from "../auth/useProfile.js";
import { ApiError } from "../services/api.js";
import { EmptyState } from "../shared/EmptyState.js";
import { LicenseCard } from "../shared/LicenseCard.js";
import { LoadingState } from "../shared/LoadingState.js";
import { QueryErrorState } from "../shared/QueryErrorState.js";
import { StatusBadge } from "../shared/StatusBadge.js";
import { formatDateTime } from "../shared/format.js";

/**
 * One-time owner claim (Section 03's `/owner-bootstrap`). No automatic
 * "first user becomes owner" exists anywhere server-side — reaching
 * OWNER requires the exact `OWNER_BOOTSTRAP_SECRET` value, which only
 * ever lives server-side (never in this bundle). This form is the only
 * way to reach that endpoint without a raw API call; it succeeds at
 * most once ever, for whichever caller gets there first, and the
 * server permanently disables the endpoint afterward.
 */
function OwnerBootstrapForm(): JSX.Element {
  const { session } = useAuthIdentity();
  const [secret, setSecret] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [succeeded, setSucceeded] = useState(false);

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault();
    if (!secret) return;
    setError(undefined);
    setSubmitting(true);
    bootstrapOwner(session.token, secret)
      .then(() => {
        setSubmitting(false);
        setSucceeded(true);
      })
      .catch((caught: unknown) => {
        setSubmitting(false);
        setError(caught instanceof ApiError ? caught.message : "Could not claim owner access.");
      });
  };

  if (succeeded) {
    return <p className="card__meta">Owner access granted. Close and reopen the app to see it take effect.</p>;
  }

  return (
    <div className="card">
      <div className="card__header">
        <span className="card__title">Claim owner access</span>
      </div>
      <p className="card__detail">One-time only — enter the OWNER_BOOTSTRAP_SECRET you set on the server.</p>
      <form onSubmit={handleSubmit}>
        <div className="field">
          <label className="field__label" htmlFor="owner-bootstrap-secret">
            Secret
          </label>
          <input id="owner-bootstrap-secret" className="field__input" type="password" value={secret} onChange={(event) => setSecret(event.target.value)} required />
        </div>
        <button type="submit" className="button" disabled={submitting || !secret}>
          {submitting ? "Claiming…" : "Claim owner access"}
        </button>
      </form>
      {error ? <QueryErrorState code="OWNER_BOOTSTRAP_FAILED" message={error} /> : null}
    </div>
  );
}

const ENTITLEMENT_LABELS: Readonly<Record<string, string>> = {
  football_analysis: "Football Analysis",
  football_tickets: "Football Tickets",
  football_automation: "Football Automation",
  aviator_analysis: "Aviator Analysis",
  aviator_automation: "Aviator Automation",
  telegram_auto_publish: "Telegram Auto-Publish",
  telegram_multi_channel: "Telegram Multi-Channel",
  weekly_reports: "Weekly Reports",
  advanced_analytics: "Advanced Analytics",
};

/**
 * Account / License (Section 09 §10/§29/§30). Real `/me` data only — no
 * raw license key, session token, or other credential-shaped value is
 * ever rendered (`UserProfile`/`AuthSessionHandle` carry none to begin
 * with). Session state (expiry) is shown so a user can see when they'll
 * need to reopen the app, never a raw token.
 */
export function AccountPage(): JSX.Element {
  const { identity, session } = useAuthIdentity();
  const profileQuery = useProfile(session.token);

  return (
    <section className="page">
      <h1>Account</h1>

      <div className="card">
        <p className="profile-card__name">
          {identity.firstName}
          {identity.username ? ` (@${identity.username})` : ""}
        </p>
        <p className="card__detail">Role: {identity.role}</p>
        {identity.status !== "active" ? <StatusBadge label={`Account ${identity.status}`} tone="danger" /> : null}
        {identity.authMode === "dev" ? <span className="identity-badge__dev-tag">DEV MODE</span> : null}
        <p className="card__meta">Session expires {formatDateTime(session.expiresAt)}</p>
      </div>

      {identity.role === "owner" || identity.role === "admin" ? (
        <Link to="/admin" className="button button--secondary">
          Admin
        </Link>
      ) : (
        <OwnerBootstrapForm />
      )}

      {profileQuery.status === "loading" ? <LoadingState label="Loading your license…" /> : null}
      {profileQuery.status === "error" ? <QueryErrorState code={profileQuery.code} message={profileQuery.message} onRetry={profileQuery.refetch} /> : null}

      {profileQuery.status === "success" ? (
        <>
          <h2 className="section-heading">License</h2>
          <LicenseCard license={profileQuery.data.license} />

          <h2 className="section-heading">Enabled features</h2>
          {profileQuery.data.entitlements.length === 0 ? (
            <EmptyState title="No features enabled" message="No features are enabled on this license yet." />
          ) : (
            <ul className="entitlement-list">
              {profileQuery.data.entitlements.map((feature) => (
                <li key={feature}>{ENTITLEMENT_LABELS[feature] ?? feature}</li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </section>
  );
}
