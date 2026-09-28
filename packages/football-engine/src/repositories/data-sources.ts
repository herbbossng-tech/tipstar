import { generateId, ValidationError } from "@sport-os/shared";
import type { SupabaseClient } from "@sport-os/platform";
import type { DataSource } from "../canonical.js";
import type { DataSourceRow } from "../db/types.js";

/** DataSource registry repository (Section 04 — Data Provenance). See data_sources' migration comment: not a hard FK dependency for other tables. */
export interface DataSourcesRepository {
  registerOrUpdate(provider: string, displayName: string, kind: "football_data" | "odds", baseUrl: string | undefined): Promise<DataSource>;
  getByProvider(provider: string): Promise<DataSource | undefined>;
}

function rowToDomain(row: DataSourceRow): DataSource {
  return { id: row.id, provider: row.provider, displayName: row.display_name, kind: row.kind, enabled: row.enabled, baseUrl: row.base_url ?? undefined };
}

export class InMemoryDataSourcesRepository implements DataSourcesRepository {
  private readonly byProvider = new Map<string, DataSource>();

  async registerOrUpdate(provider: string, displayName: string, kind: "football_data" | "odds", baseUrl: string | undefined): Promise<DataSource> {
    const existing = this.byProvider.get(provider);
    const source: DataSource = { id: existing?.id ?? generateId(), provider, displayName, kind, enabled: existing?.enabled ?? true, baseUrl };
    this.byProvider.set(provider, source);
    return source;
  }

  async getByProvider(provider: string): Promise<DataSource | undefined> {
    return this.byProvider.get(provider);
  }
}

export class SupabaseDataSourcesRepository implements DataSourcesRepository {
  constructor(private readonly client: SupabaseClient) {}

  async registerOrUpdate(provider: string, displayName: string, kind: "football_data" | "odds", baseUrl: string | undefined): Promise<DataSource> {
    const { data, error } = await this.client
      .from("data_sources")
      .upsert({ provider, display_name: displayName, kind, base_url: baseUrl ?? null }, { onConflict: "provider" })
      .select("*")
      .single();
    if (error || !data) {
      throw new ValidationError({ message: "Failed to register data source.", code: "DATA_SOURCE_UPSERT_FAILED", context: { reason: error?.message } });
    }
    return rowToDomain(data as DataSourceRow);
  }

  async getByProvider(provider: string): Promise<DataSource | undefined> {
    const { data, error } = await this.client.from("data_sources").select("*").eq("provider", provider).maybeSingle();
    if (error || !data) return undefined;
    return rowToDomain(data as DataSourceRow);
  }
}
