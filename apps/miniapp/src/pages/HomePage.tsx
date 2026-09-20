import type { TelegramBootstrapResult } from "../telegram/bootstrap.js";

export interface HomePageProps {
  readonly telegram: TelegramBootstrapResult;
}

/**
 * Section 01 placeholder. Real dashboard content (latest qualified picks,
 * agent highlights) is out of scope here — see Section 32, scope control.
 */
export function HomePage({ telegram }: HomePageProps): JSX.Element {
  return (
    <section className="page">
      <h1>Tipstar</h1>
      <p>Sports intelligence &amp; betting companion.</p>
      <p className="page__meta">
        {telegram.isRunningInTelegram ? "Running inside Telegram." : "Running outside Telegram (dev mode)."}
      </p>
    </section>
  );
}
