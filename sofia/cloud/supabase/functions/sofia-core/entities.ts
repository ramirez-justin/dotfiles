import type { SupabaseClient } from "@supabase/supabase-js";

export type EntityType =
  | "person"
  | "organization"
  | "project"
  | "repo"
  | "system"
  | "tool"
  | "decision"
  | "place"
  | "topic"
  | "artifact";

export type EntityInput = {
  type: string;
  name: string;
  evidence?: string;
  aliases?: string[];
  external_refs?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

const ENTITY_TYPE_ALIASES: Record<string, EntityType> = {
  artifact: "artifact",
  broker: "organization",
  company: "organization",
  database: "system",
  decision: "decision",
  organization: "organization",
  org: "organization",
  person: "person",
  place: "place",
  project: "project",
  repository: "repo",
  repo: "repo",
  system: "system",
  technology: "tool",
  tool: "tool",
  topic: "topic",
};

export function normalizeEntityName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\-_/]+/g, " ")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeEntityType(type: string): EntityType | null {
  const normalized = normalizeEntityName(type).replace(/\s+/g, "_");
  return ENTITY_TYPE_ALIASES[normalized] ?? null;
}

export async function resolveEntity(
  supabase: SupabaseClient,
  input: EntityInput,
): Promise<string | null> {
  const entityType = normalizeEntityType(input.type);
  const name = input.name?.trim();
  const normalizedName = normalizeEntityName(input.name ?? "");
  if (!entityType || !name || !normalizedName) return null;

  const canonical = await findCanonicalEntity(
    supabase,
    entityType,
    normalizedName,
  );
  if (canonical) return canonical;

  const aliases = uniqueAliases([name, ...(input.aliases ?? [])]);
  for (const alias of aliases) {
    const byAlias = await findEntityByAlias(
      supabase,
      entityType,
      normalizeEntityName(alias),
    );
    if (byAlias) return byAlias;
  }

  const { data, error } = await supabase
    .from("entities")
    .insert({
      entity_type: entityType,
      name,
      normalized_name: normalizedName,
      external_refs: input.external_refs ?? {},
      metadata: input.metadata ?? {},
      status: "active",
    })
    .select("id")
    .single();

  if (error) throw new Error(`insert entity failed: ${error.message}`);
  const entityId = data.id as string;
  await insertAliases(supabase, entityId, aliases);
  return entityId;
}

export async function findEntityId(
  supabase: SupabaseClient,
  name: string,
): Promise<string | null> {
  const normalizedName = normalizeEntityName(name);
  if (!normalizedName) return null;

  const canonical = await findCanonicalEntityByName(supabase, normalizedName);
  if (canonical) return canonical;

  return await findEntityByAnyAlias(supabase, normalizedName);
}

async function findCanonicalEntity(
  supabase: SupabaseClient,
  entityType: EntityType,
  normalizedName: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("entities")
    .select("id")
    .eq("entity_type", entityType)
    .eq("normalized_name", normalizedName)
    .eq("status", "active")
    .maybeSingle();

  if (error) throw new Error(`find entity failed: ${error.message}`);
  return (data?.id as string | undefined) ?? null;
}

async function findCanonicalEntityByName(
  supabase: SupabaseClient,
  normalizedName: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("entities")
    .select("id")
    .eq("normalized_name", normalizedName)
    .eq("status", "active")
    .maybeSingle();

  if (error) throw new Error(`find entity failed: ${error.message}`);
  return (data?.id as string | undefined) ?? null;
}

async function findEntityByAlias(
  supabase: SupabaseClient,
  entityType: EntityType,
  normalizedAlias: string,
): Promise<string | null> {
  if (!normalizedAlias) return null;
  const { data, error } = await supabase
    .from("entities")
    .select("id, entity_aliases!inner(normalized_alias)")
    .eq("entity_type", entityType)
    .eq("status", "active")
    .eq("entity_aliases.normalized_alias", normalizedAlias)
    .maybeSingle();

  if (error) throw new Error(`find entity alias failed: ${error.message}`);
  return (data?.id as string | undefined) ?? null;
}

async function findEntityByAnyAlias(
  supabase: SupabaseClient,
  normalizedAlias: string,
): Promise<string | null> {
  if (!normalizedAlias) return null;
  const { data, error } = await supabase
    .from("entities")
    .select("id, entity_aliases!inner(normalized_alias)")
    .eq("status", "active")
    .eq("entity_aliases.normalized_alias", normalizedAlias)
    .maybeSingle();

  if (error) throw new Error(`find entity alias failed: ${error.message}`);
  return (data?.id as string | undefined) ?? null;
}

async function insertAliases(
  supabase: SupabaseClient,
  entityId: string,
  aliases: string[],
): Promise<void> {
  const rows = aliases.map((alias) => ({
    entity_id: entityId,
    alias,
    normalized_alias: normalizeEntityName(alias),
    source: "agent",
    confidence: 1,
    metadata: {},
  })).filter((row) => row.normalized_alias);

  if (rows.length === 0) return;
  const { error } = await supabase.from("entity_aliases").insert(rows);
  if (error && !isUniquenessError(error)) {
    throw new Error(`insert entity aliases failed: ${error.message}`);
  }
}

function uniqueAliases(aliases: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const alias of aliases) {
    const trimmed = alias.trim();
    const normalized = normalizeEntityName(trimmed);
    if (!trimmed || !normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(trimmed);
  }
  return result;
}

function isUniquenessError(error: { code?: string; message?: string }): boolean {
  return error.code === "23505" ||
    /duplicate key|unique constraint/i.test(error.message ?? "");
}
