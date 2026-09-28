import { useAuthIdentity } from "../auth/AuthContext.js";

/**
 * Minimal identity area (Section 02): welcome name, @username, and a
 * dev-mode marker when applicable. Never renders a Telegram user id,
 * session token, or any other credential-shaped value.
 */
export function IdentityBadge(): JSX.Element {
  const { identity } = useAuthIdentity();

  return (
    <div className="identity-badge">
      <span className="identity-badge__name">
        {identity.firstName}
        {identity.username ? ` (@${identity.username})` : ""}
      </span>
      {identity.authMode === "dev" ? <span className="identity-badge__dev-tag">DEV MODE</span> : null}
    </div>
  );
}
