import assert from "node:assert/strict";
import { findEntityId, normalizeEntityName, resolveEntity } from "./entities.ts";

type TableCall = { table: string; operation: string; payload?: unknown };

type FakeConfig = {
  canonicalEntity?: Record<string, unknown> | null;
  aliasEntity?: Record<string, unknown> | null;
  insertedEntityId?: string;
};

function fakeSupabase(config: FakeConfig = {}) {
  const calls: TableCall[] = [];
  const client = {
    calls,
    from(table: string) {
      let operation: string | null = null;
      let selectColumns: string | undefined;
      const query = {
        insert(payload: unknown) {
          operation = "insert";
          calls.push({ table, operation, payload });
          return query;
        },
        select(columns?: string) {
          selectColumns = columns;
          return query;
        },
        eq(_column: string, _value: unknown) {
          return query;
        },
        maybeSingle() {
          if (table === "entities" && selectColumns?.includes("entity_aliases")) {
            return Promise.resolve({
              data: config.aliasEntity ?? null,
              error: null,
            });
          }
          if (table === "entities") {
            return Promise.resolve({
              data: config.canonicalEntity ?? null,
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: null });
        },
        single() {
          if (table === "entities" && operation === "insert") {
            return Promise.resolve({
              data: { id: config.insertedEntityId ?? "entity-new" },
              error: null,
            });
          }
          return Promise.resolve({ data: {}, error: null });
        },
        then(resolve: (value: { data?: unknown; error: null }) => void) {
          resolve({ error: null });
        },
      };
      return query;
    },
  };
  return client;
}

Deno.test("normalizeEntityName creates stable lowercase search keys", () => {
  assert.equal(normalizeEntityName(" Telophase-QS "), "telophase qs");
  assert.equal(normalizeEntityName("GKE/NautilusTrader"), "gke nautilustrader");
});

Deno.test("resolveEntity returns existing canonical entity id", async () => {
  const client = fakeSupabase({
    canonicalEntity: { id: "entity-tqs", name: "TelophaseQS" },
  });

  const entityId = await resolveEntity(client as never, {
    type: "project",
    name: "TelophaseQS",
  });

  assert.equal(entityId, "entity-tqs");
  assert.deepEqual(client.calls, []);
});

Deno.test("resolveEntity returns existing entity id by alias", async () => {
  const client = fakeSupabase({
    canonicalEntity: null,
    aliasEntity: { id: "entity-tqs", name: "TelophaseQS" },
  });

  const entityId = await resolveEntity(client as never, {
    type: "project",
    name: "TQS",
  });

  assert.equal(entityId, "entity-tqs");
  assert.deepEqual(client.calls, []);
});

Deno.test("findEntityId resolves canonical names and aliases without inserts", async () => {
  const canonicalClient = fakeSupabase({
    canonicalEntity: { id: "entity-sofia", name: "SOFIA" },
  });
  const aliasClient = fakeSupabase({
    canonicalEntity: null,
    aliasEntity: { id: "entity-tqs", name: "TelophaseQS" },
  });

  assert.equal(await findEntityId(canonicalClient as never, "SOFIA"), "entity-sofia");
  assert.equal(await findEntityId(aliasClient as never, "TQS"), "entity-tqs");
  assert.deepEqual(canonicalClient.calls, []);
  assert.deepEqual(aliasClient.calls, []);
});

Deno.test("findEntityId returns null for missing names", async () => {
  const client = fakeSupabase({ canonicalEntity: null, aliasEntity: null }) as never;

  assert.equal(await findEntityId(client, "Missing Entity"), null);
});

Deno.test("resolveEntity inserts entity and canonical aliases when missing", async () => {
  const client = fakeSupabase({
    canonicalEntity: null,
    aliasEntity: null,
    insertedEntityId: "entity-new",
  });

  const entityId = await resolveEntity(client as never, {
    type: "technology",
    name: "NautilusTrader",
    aliases: ["nautilus trader"],
    external_refs: { repo: "nautechsystems/nautilus_trader" },
    metadata: { source: "classifier" },
  });

  assert.equal(entityId, "entity-new");
  assert.deepEqual(client.calls, [
    {
      table: "entities",
      operation: "insert",
      payload: {
        entity_type: "tool",
        name: "NautilusTrader",
        normalized_name: "nautilustrader",
        external_refs: { repo: "nautechsystems/nautilus_trader" },
        metadata: { source: "classifier" },
        status: "active",
      },
    },
    {
      table: "entity_aliases",
      operation: "insert",
      payload: [
        {
          entity_id: "entity-new",
          alias: "NautilusTrader",
          normalized_alias: "nautilustrader",
          source: "agent",
          confidence: 1,
          metadata: {},
        },
        {
          entity_id: "entity-new",
          alias: "nautilus trader",
          normalized_alias: "nautilus trader",
          source: "agent",
          confidence: 1,
          metadata: {},
        },
      ],
    },
  ]);
});

Deno.test("resolveEntity ignores empty entity inputs", async () => {
  const client = fakeSupabase();

  assert.equal(await resolveEntity(client as never, { type: "project", name: " " }), null);
  assert.equal(await resolveEntity(client as never, { type: "", name: "SOFIA" }), null);
  assert.deepEqual(client.calls, []);
});
