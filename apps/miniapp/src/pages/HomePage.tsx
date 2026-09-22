import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider.js";
import { EmptyState } from "../components/EmptyState.js";
import { useTelegram } from "../telegram/TelegramProvider.js";

/**
 * Section 02 foundation. Real dashboard content (latest qualified picks,
 * agent highlights) is out of scope here — see Section 32, scope control.
 * No fabricated predictions/win rates/picks — Section 41 is permanent.
 */
export function HomePage(): JSX.Element {
  const { currentUser } = useAuth();
  const telegram = useTelegram();

  const name = currentUser?.telegram.firstName ?? telegram.unsafeUser?.firstName;

  return (
    <section className="page">
      <h1>Tipstar</h1>
      <p className="page__subtitle">{name ? `Welcome back, ${name}.` : "Sports intelligence & betting companion."}</p>
      <p className="page__meta">{telegram.isRunningInTelegram ? "Running inside Telegram." : "Running outside Telegram (dev mode)."}</p>

      <div className="card">
        <p className="card__title">Today's intelligence</p>
        <EmptyState title="Intelligence is being prepared." message="The Intelligence and Pick Engine come online in a later section." />
      </div>

      <div className="card">
        <p className="card__title">Quick navigation</p>
        <div className="card__row">
          <Link to="/picks" className="card__row-label">Picks</Link>
        </div>
        <div className="card__row">
          <Link to="/matches" className="card__row-label">Matches</Link>
        </div>
        <div className="card__row">
          <Link to="/performance" className="card__row-label">Performance</Link>
        </div>
      </div>

      <div className="card">
        <p className="card__title">System status</p>
        <div className="card__row">
          <span className="card__row-label">Telegram</span>
          <span className="badge badge--success">{telegram.isRunningInTelegram ? "Connected" : "Not detected"}</span>
        </div>
        <div className="card__row">
          <span className="card__row-label">Account</span>
          <span className="badge badge--success">Signed in</span>
        </div>
      </div>
    </section>
  );
}
