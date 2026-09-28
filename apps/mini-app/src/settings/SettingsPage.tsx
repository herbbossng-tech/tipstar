import { useEffect, useState } from "react";
import { useAuthIdentity } from "../auth/AuthContext.js";
import { fetchOwnProfile } from "../auth/profileApi.js";
import type { UserProfile } from "../auth/types.js";
import { ApiError } from "../services/api.js";

type ProfileLoadState = { readonly status: "loading" } | { readonly status: "loaded"; readonly profile: UserProfile } | { readonly status: "error"; readonly message: string };

/**
 * Minimal authenticated user area (Section 03 — Frontend). Shows only
 * real, server-verified data via `/me`: Telegram identity, role, license
 * status, and enabled feature names. Never fabricates a trial license —
 * an absent license renders an honest "No active license" state. No raw
 * license key, audit metadata, or service credential is ever requested
 * or rendered here.
 */
export function SettingsPage(): JSX.Element {
  const { identity, session } = useAuthIdentity();
  const [state, setState] = useState<ProfileLoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetchOwnProfile(session.token)
      .then((profile) => {
        if (!cancelled) setState({ status: "loaded", profile });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof ApiError ? error.message : "Couldn't load your account details.";
        setState({ status: "error", message });
      });
    return () => {
      cancelled = true;
    };
  }, [session.token]);

  return (
    <section className="page">
      <h1>Settings</h1>
      <p className="page__subtitle">Your account</p>

      <div className="profile-card">
        <p className="profile-card__name">
          {identity.firstName}
          {identity.username ? ` (@${identity.username})` : ""}
        </p>
        <p className="profile-card__role">Role: {identity.role}</p>
        {identity.status !== "active" ? <p className="profile-card__status-warning">Account status: {identity.status}</p> : null}
      </div>

      {state.status === "loading" ? (
        <div className="state state--loading" role="status" aria-live="polite">
          <span className="state__spinner" aria-hidden="true" />
          <p className="state__message">Loading your license…</p>
        </div>
      ) : null}

      {state.status === "error" ? (
        <div className="state state--error" role="alert">
          <p className="state__message">{state.message}</p>
        </div>
      ) : null}

      {state.status === "loaded" && state.profile.license === null ? (
        <div className="state state--empty">
          <p className="state__title">No active license</p>
          <p className="state__message">You don't currently have an active or trial license.</p>
        </div>
      ) : null}

      {state.status === "loaded" && state.profile.license !== null ? (
        <div className="profile-card">
          <p className="profile-card__license-plan">Plan: {state.profile.license.plan}</p>
          <p className="profile-card__license-status">License status: {state.profile.license.status}</p>
          {state.profile.entitlements.length > 0 ? (
            <ul className="profile-card__entitlements">
              {state.profile.entitlements.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
          ) : (
            <p className="profile-card__no-entitlements">No features enabled on this license yet.</p>
          )}
        </div>
      ) : null}
    </section>
  );
}
