import type { ReactNode } from "react";
import { useAuthIdentity } from "../auth/AuthContext.js";

/**
 * Cosmetic-only gate for the `/admin/*` route tree (Section 11 §R/§S:
 * "frontend gating is cosmetic... every backend endpoint independently
 * verifies session/role/authorization"). This component hides the
 * admin screens from a USER so they don't see a UI they can't use —
 * it is NOT the authorization boundary. Every `admin-*` edge function
 * this UI calls re-derives the caller's role server-side from their
 * verified session (`requireAdminRole`, `supabase/functions/_shared/
 * auth.ts`) and would refuse a non-admin regardless of what this
 * component renders.
 */
export function AdminGuard({ children }: { readonly children: ReactNode }): JSX.Element {
  const { identity } = useAuthIdentity();

  if (identity.role !== "owner" && identity.role !== "admin") {
    return (
      <section className="page">
        <h1>Admin</h1>
        <div className="state state--error" role="alert">
          <p className="state__title">Administrative access required</p>
          <p className="state__message">This area is only available to OWNER/ADMIN accounts.</p>
        </div>
      </section>
    );
  }

  return <>{children}</>;
}
