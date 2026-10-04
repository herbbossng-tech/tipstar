import { useState, type FormEvent } from "react";
import { useAuthIdentity } from "../auth/AuthContext.js";
import { createAdminLicense, listAdminUsers } from "../api/adminApi.js";
import { ApiError } from "../services/api.js";
import { useQuery } from "../hooks/useQuery.js";
import { EmptyState } from "../shared/EmptyState.js";
import { formatDateTime } from "../shared/format.js";
import { LoadingState } from "../shared/LoadingState.js";
import { QueryErrorState } from "../shared/QueryErrorState.js";
import { AdminGuard } from "./AdminGuard.js";

const FEATURE_KEYS = ["football_analysis", "football_tickets", "football_automation", "aviator_analysis", "aviator_automation", "telegram_auto_publish", "telegram_multi_channel", "weekly_reports", "advanced_analytics"] as const;

const FEATURE_LABELS: Readonly<Record<string, string>> = {
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
 * Licenses (completes Section 11's admin UI — the underlying
 * createLicense() domain rule already existed and was already tested;
 * this is the first UI surface that calls it). Only creates a NEW
 * license for a user with none — never edits/overwrites an existing
 * one, matching the database's own "one active/trial license per user"
 * constraint and the locked append-only license history model.
 */
function AdminLicensesContent(): JSX.Element {
  const { session } = useAuthIdentity();
  const query = useQuery(() => listAdminUsers(session.token), [session.token]);

  const [selectedUserId, setSelectedUserId] = useState("");
  const [plan, setPlan] = useState("pro");
  const [status, setStatus] = useState<"trial" | "active">("active");
  const [expiresAt, setExpiresAt] = useState("");
  const [selectedFeatures, setSelectedFeatures] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [resultMessage, setResultMessage] = useState<string | undefined>(undefined);

  const toggleFeature = (key: string): void => {
    setSelectedFeatures((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault();
    if (!selectedUserId || !plan) return;
    setError(undefined);
    setResultMessage(undefined);
    setSubmitting(true);
    createAdminLicense(session.token, { userId: selectedUserId, plan, status, expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null, maxDevices: null, entitlements: [...selectedFeatures] })
      .then((result) => {
        setSubmitting(false);
        setResultMessage(`License created (${result.license.plan}, ${result.license.status}) for this user.`);
        query.refetch();
      })
      .catch((caught: unknown) => {
        setSubmitting(false);
        setError(caught instanceof ApiError ? caught.message : "Could not create the license.");
      });
  };

  return (
    <section className="page">
      <h1>Licenses</h1>
      <p className="page__subtitle">Create a license for a user who doesn't have one (Section 03). Renewing or reactivating an existing license is a separate action, not covered here yet.</p>

      {query.status === "loading" ? <LoadingState label="Loading users…" /> : null}
      {query.status === "error" ? <QueryErrorState code={query.code} message={query.message} onRetry={query.refetch} /> : null}

      {query.status === "success" ? (
        <div className="card">
          <div className="card__header">
            <span className="card__title">Create a license</span>
          </div>
          <form onSubmit={handleSubmit}>
            <div className="field">
              <label className="field__label" htmlFor="admin-license-user">
                User
              </label>
              <select id="admin-license-user" className="field__input" value={selectedUserId} onChange={(event) => setSelectedUserId(event.target.value)} required>
                <option value="">Select a user…</option>
                {query.data.users.map(({ user, currentLicense }) => (
                  <option key={user.id} value={user.id} disabled={currentLicense !== null}>
                    {user.first_name}
                    {user.username ? ` (@${user.username})` : ""} — {user.role}
                    {currentLicense ? ` — already has a ${currentLicense.status} license` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="field__label" htmlFor="admin-license-plan">
                Plan
              </label>
              <input id="admin-license-plan" className="field__input" type="text" value={plan} onChange={(event) => setPlan(event.target.value)} required />
            </div>
            <div className="filter-row" role="tablist" aria-label="License status">
              <button type="button" role="tab" aria-selected={status === "active"} className={`chip${status === "active" ? " chip--active" : ""}`} onClick={() => setStatus("active")}>
                Active
              </button>
              <button type="button" role="tab" aria-selected={status === "trial"} className={`chip${status === "trial" ? " chip--active" : ""}`} onClick={() => setStatus("trial")}>
                Trial
              </button>
            </div>
            <div className="field">
              <label className="field__label" htmlFor="admin-license-expires">
                Expires (optional — leave blank for no expiry)
              </label>
              <input id="admin-license-expires" className="field__input" type="date" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} />
            </div>
            <fieldset>
              <legend className="field__label">Features to enable</legend>
              <div className="filter-row">
                {FEATURE_KEYS.map((key) => (
                  <button type="button" key={key} role="tab" aria-selected={selectedFeatures.has(key)} className={`chip${selectedFeatures.has(key) ? " chip--active" : ""}`} onClick={() => toggleFeature(key)}>
                    {FEATURE_LABELS[key]}
                  </button>
                ))}
              </div>
            </fieldset>
            <button type="submit" className="button" disabled={submitting || !selectedUserId || !plan}>
              {submitting ? "Creating…" : "Create license"}
            </button>
          </form>
          {error ? <QueryErrorState code="LICENSE_CREATE_FAILED" message={error} /> : null}
          {resultMessage ? <p className="card__meta">{resultMessage}</p> : null}
        </div>
      ) : null}

      {query.status === "success" && query.data.users.length === 0 ? <EmptyState title="No users" message="No users have authenticated yet." /> : null}

      {query.status === "success" && query.data.users.length > 0 ? (
        <div className="card-list">
          {query.data.users.map(({ user, currentLicense }) => (
            <div className="card" key={user.id}>
              <div className="card__header">
                <span className="card__title">
                  {user.first_name}
                  {user.username ? ` (@${user.username})` : ""}
                </span>
                <span className="tag">{user.role}</span>
              </div>
              <p className="card__detail">{currentLicense ? `${currentLicense.plan} — ${currentLicense.status}${currentLicense.expires_at ? ` — expires ${formatDateTime(currentLicense.expires_at)}` : ""}` : "No active or trial license"}</p>
              <p className="card__meta">Joined {formatDateTime(user.created_at)}</p>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function AdminLicensesPage(): JSX.Element {
  return (
    <AdminGuard>
      <AdminLicensesContent />
    </AdminGuard>
  );
}
