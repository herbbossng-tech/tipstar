import type { ISODateString } from "@sport-os/shared";

/**
 * Provider-agnostic architecture (Section 04). The football engine never
 * depends on a vendor SDK directly — a provider adapter translates one
 * external provider's shapes into RawRecord bags here, and normalization
 * (see normalize.ts) turns those into canonical.ts types. No concrete
 * provider is connected in this section (see adapters/test-fixture-provider.ts
 * and docs/architecture/FOOTBALL_DATA_ARCHITECTURE.md's "Providers
 * actually connected").
 */

/** An unvalidated, provider-shaped record — exactly what the provider returned, before normalization. */
export type RawRecord = Readonly<Record<string, unknown>>;

export interface ProviderConfig {
  readonly provider: string;
  readonly enabled: boolean;
  readonly baseUrl: string | undefined;
  /** The resolved credential value, if configured — never logged, never serialized to the client. See docs/environment-variables.md. */
  readonly apiKey: string | undefined;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly rateLimitPerMinute: number | undefined;
  readonly pollIntervalSeconds: number | undefined;
}

export type ProviderFetchOutcome<T> =
  | { readonly status: "ok"; readonly records: readonly T[]; readonly fetchedAt: ISODateString }
  /** "Provider unavailable: do not fabricate data." — the caller must treat this as "we don't know", never as "zero records". */
  | { readonly status: "unavailable"; readonly reason: string }
  | { readonly status: "rate_limited"; readonly retryAfterSeconds: number | undefined };

export interface FixtureFetchParams {
  readonly since?: ISODateString;
  readonly until?: ISODateString;
  readonly competitionProviderId?: string;
}

export interface FootballFixtureProvider {
  readonly provider: string;
  fetchFixtures(params: FixtureFetchParams): Promise<ProviderFetchOutcome<RawRecord>>;
}

export interface FootballTeamProvider {
  readonly provider: string;
  fetchTeams(params: { readonly competitionProviderId?: string }): Promise<ProviderFetchOutcome<RawRecord>>;
}

export interface FootballEventProvider {
  readonly provider: string;
  fetchEvents(params: { readonly fixtureProviderId: string }): Promise<ProviderFetchOutcome<RawRecord>>;
}

export interface FootballOddsProvider {
  readonly provider: string;
  fetchOdds(params: { readonly fixtureProviderId: string }): Promise<ProviderFetchOutcome<RawRecord>>;
}

/**
 * Declared for completeness (the section spec names it explicitly) but
 * deliberately not implemented against or backed by a database table
 * this section — "avoid premature player-level complexity if the
 * selected provider cannot support it reliably" and no provider is
 * connected at all yet. See docs/architecture/OPEN_QUESTIONS.md.
 */
export interface FootballPlayerProvider {
  readonly provider: string;
  fetchPlayers(params: { readonly teamProviderId: string }): Promise<ProviderFetchOutcome<RawRecord>>;
}

/** The umbrella a concrete adapter implements some/all facets of, depending on what that specific provider actually supports — never assume every provider offers everything. */
export interface FootballDataProvider {
  readonly provider: string;
  readonly config: ProviderConfig;
  readonly fixtures?: FootballFixtureProvider;
  readonly teams?: FootballTeamProvider;
  readonly events?: FootballEventProvider;
  readonly odds?: FootballOddsProvider;
  readonly players?: FootballPlayerProvider;
}

/**
 * Bounded retry helper (Section 04 — Retries/Rate Limiting: "Never
 * implement infinite retries"). Retries only on a thrown exception (a
 * genuine transport failure) — a well-formed ProviderFetchOutcome of
 * "unavailable"/"rate_limited" is a normal, structured result and is
 * returned as-is, not retried here (the caller decides whether/when to
 * poll again, honoring pollIntervalSeconds).
 */
export async function withBoundedRetries<T>(operation: () => Promise<T>, maxRetries: number, delayMs = 200): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)));
      }
    }
  }
  throw lastError;
}
