import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { SCHEMA } from "../src/worker/schema";
import { createTestDb } from "./d1";

// The first-request schema must match what migrations/ produce, column for column.
function shape(db: DatabaseSync) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'index') AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[];
  return tables.map(({ name }) => ({
    name,
    columns: db.prepare(`PRAGMA table_info(${name})`).all(),
    indexColumns: db.prepare(`PRAGMA index_info(${name})`).all(),
  }));
}

describe("schema", () => {
  it("matches the migrations", () => {
    const fresh = new DatabaseSync(":memory:");
    for (const sql of SCHEMA) fresh.exec(sql);
    expect(shape(fresh)).toEqual(shape(createTestDb().raw));
  });

  it("can run again on an existing database", () => {
    const { raw } = createTestDb();
    for (const sql of SCHEMA) raw.exec(sql);
  });
});
