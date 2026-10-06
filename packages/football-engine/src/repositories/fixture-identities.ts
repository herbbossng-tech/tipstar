import { generateId, ValidationError, type UUID } from "@sport-os/shared";
import type { SupabaseClient } from "@sport-os/platform";
import type { FixtureExternalIdentityRow } from "../db/types.js";

/**
 * Fixture external identity reconciliation repository (Section 13 — see
 * migration 20261005200100_fixture_external_identities.sql and
 * ingestion.ts's `FixtureIdentityResolver`).
 *
 * Sportmonks (the canonical football-data provider) is the ONLY provider
 * `public.fixtures` is keyed by (`unique(provider, provider_fixture_id)`).
 * A second provider's own fixture/event id (e.g. The Odds API) is never
 * assumed to equal a Sportmonks id, so a confirmed cross-reference is
 * recorded here instead — and only after an explicit, non-ambiguous match
 * (team names + kickoff time, performed by the odds-ingestion worker job
 * before odds ingestion runs; an ambiguous candidate is quarantined, never
 * guessed into a mapping row).
 *
 * `resolve()` is a pure lookup — it implements `FixtureIdentityResolver`
 * structurally (no import from ingestion.ts, to keep this repository
 * layer free of a dependency on the orchestration layer) and never
 * performs matching itself.
 */

export interface FixtureExternalIdentity {
  readonly id: UUID;
  readonly fixtureId: UUID;
  readonly provider: string;
  readonly providerFixtureId: string;
  readonly matchMethod: string;
  readonly createdAt: string;
}

export interface NewFixtureExternalIdentityInput {
  readonly fixtureId: UUID;
  readonly provider: string;
  readonly providerFixtureId: string;
  readonly matchMethod: string;
}

export interface FixtureExternalIdentitiesRepository {
  /**
   * Idempotent: a repeat call for an already-mapped (provider,
   * providerFixtureId) returns the existing mapping unchanged — it never
   * overwrites fixtureId/matchMethod on conflict, mirroring fixture
   * identity immutability (see repositories/fixtures.ts).
   */
  recordMapping(input: NewFixtureExternalIdentityInput): Promise<FixtureExternalIdentity>;
  getByProviderIdentity(provider: string, providerFixtureId: string): Promise<FixtureExternalIdentity | undefined>;
  /** `FixtureIdentityResolver` (ingestion.ts) implementation — a pure lookup, never a guess. */
  resolve(provider: string, providerFixtureId: string): Promise<UUID | undefined>;
}

function rowToDomain(row: FixtureExternalIdentityRow): FixtureExternalIdentity {
  return {
    id: row.id,
    fixtureId: row.fixture_id,
    provider: row.provider,
    providerFixtureId: row.provider_fixture_id,
    matchMethod: row.match_method,
    createdAt: row.created_at,
  };
}

// ============================================================
// In-memory implementation
// ============================================================

export class InMemoryFixtureExternalIdentitiesRepository implements FixtureExternalIdentitiesRepository {
  private readonly mappings: FixtureExternalIdentity[] = [];

  async recordMapping(input: NewFixtureExternalIdentityInput): Promise<FixtureExternalIdentity> {
    const existing = await this.getByProviderIdentity(input.provider, input.providerFixtureId);
    if (existing) return existing;
    const mapping: FixtureExternalIdentity = { id: generateId(), ...input, createdAt: new Date().toISOString() };
    this.mappings.push(mapping);
    return mapping;
  }

  async getByProviderIdentity(provider: string, providerFixtureId: string): Promise<FixtureExternalIdentity | undefined> {
    return this.mappings.find((m) => m.provider === provider && m.providerFixtureId === providerFixtureId);
  }

  async resolve(provider: string, providerFixtureId: string): Promise<UUID | undefined> {
    const mapping = await this.getByProviderIdentity(provider, providerFixtureId);
    return mapping?.fixtureId;
  }
}

// ============================================================
// Supabase-backed implementation
// ============================================================

export class SupabaseFixtureExternalIdentitiesRepository implements FixtureExternalIdentitiesRepository {
  constructor(private readonly client: SupabaseClient) {}

  async recordMapping(input: NewFixtureExternalIdentityInput): Promise<FixtureExternalIdentity> {
    const { data, error } = await this.client
      .from("fixture_external_identities")
      .insert({
        fixture_id: input.fixtureId,
        provider: input.provider,
        provider_fixture_id: input.providerFixtureId,
        match_method: input.matchMethod,
      })
      .select("*")
      .single();
    if (!error && data) return rowToDomain(data as FixtureExternalIdentityRow);

    // 23505 = unique_violation on (provider, provider_fixture_id) — another
    // call already recorded this mapping; return it as-is rather than
    // overwriting (idempotent, never a silent identity change).
    if (error?.code === "23505") {
      const existing = await this.getByProviderIdentity(input.provider, input.providerFixtureId);
      if (existing) return existing;
    }
    throw new ValidationError({ message: "Failed to record fixture external identity mapping.", code: "FIXTURE_EXTERNAL_IDENTITY_INSERT_FAILED", context: { reason: error?.message } });
  }

  async getByProviderIdentity(provider: string, providerFixtureId: string): Promise<FixtureExternalIdentity | undefined> {
    const { data, error } = await this.client.from("fixture_external_identities").select("*").eq("provider", provider).eq("provider_fixture_id", providerFixtureId).maybeSingle();
    if (error || !data) return undefined;
    return rowToDomain(data as FixtureExternalIdentityRow);
  }

  async resolve(provider: string, providerFixtureId: string): Promise<UUID | undefined> {
    const mapping = await this.getByProviderIdentity(provider, providerFixtureId);
    return mapping?.fixtureId;
  }
}
