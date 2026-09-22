import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthProvider.js";
import { ErrorState } from "../components/ErrorState.js";
import { LoadingState } from "../components/LoadingState.js";

function formatRole(role: string): string {
  return role
    .split("_")
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(" ");
}

export function AccountPage(): JSX.Element {
  const { currentUser, refresh } = useAuth();
  const [isRefreshing, setIsRefreshing] = useState(currentUser === undefined);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setIsRefreshing(true);
    refresh()
      .catch(() => {
        if (!cancelled) setLoadError("Couldn't load your account. Please try again.");
      })
      .finally(() => {
        if (!cancelled) setIsRefreshing(false);
      });
    return () => {
      cancelled = true;
    };
    // Refresh once when the Account screen is opened — refresh() is stable across renders.
  }, []);

  if (!currentUser && isRefreshing) {
    return <LoadingState label="Loading your account…" />;
  }

  if (!currentUser) {
    return <ErrorState message={loadError ?? "Couldn't load your account."} onRetry={() => void refresh()} />;
  }

  const displayName = [currentUser.telegram.firstName, currentUser.telegram.lastName].filter(Boolean).join(" ") || "Tipstar user";

  return (
    <section className="page">
      <h1>Account</h1>
      <p className="page__subtitle">Profile, subscription/entitlement status, and preferences.</p>

      <div className="card">
        <p className="card__title">{displayName}</p>
        <div className="card__row">
          <span className="card__row-label">Telegram username</span>
          <span className="card__row-value">{currentUser.telegram.username ? `@${currentUser.telegram.username}` : "—"}</span>
        </div>
        <div className="card__row">
          <span className="card__row-label">Account status</span>
          <span className="badge badge--success">{currentUser.status}</span>
        </div>
        <div className="card__row">
          <span className="card__row-label">Roles</span>
          <span className="card__row-value">{currentUser.roles.map(formatRole).join(", ") || "—"}</span>
        </div>
      </div>

      <div className="card">
        <p className="card__title">Entitlement</p>
        <div className="card__row">
          <span className="card__row-label">Subscription</span>
          <span className="badge badge--muted">Not subscribed</span>
        </div>
        <div className="card__row">
          <span className="card__row-label">Partner status</span>
          <span className="badge badge--muted">None</span>
        </div>
      </div>

      <div className="card">
        <p className="card__title">Notifications</p>
        <div className="card__row">
          <span className="card__row-label">Pick alerts</span>
          <span className="card__row-value">{currentUser.notificationPreferences?.pick_alerts ? "On" : "Off"}</span>
        </div>
        <div className="card__row">
          <span className="card__row-label">Result alerts</span>
          <span className="card__row-value">{currentUser.notificationPreferences?.result_alerts ? "On" : "Off"}</span>
        </div>
      </div>
    </section>
  );
}
