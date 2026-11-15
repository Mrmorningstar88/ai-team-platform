import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { ensureSchema, SCHEMA } from "../src/worker/schema";
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

  it("can run again on an existing database", async () => {
    const { raw, d1 } = createTestDb();
    for (const sql of SCHEMA) raw.exec(sql);
    await ensureSchema(d1);
  });

  it("adds new columns to a database from before them, keeping existing users verified", async () => {
    const { raw, d1 } = createTestDb();
    // A database created by an older first request: users without email_verified_ms.
    raw.exec("PRAGMA foreign_keys = OFF; DROP TABLE users; CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), password_hash TEXT)");
    raw.exec("INSERT INTO users (id, email, name, created_at) VALUES ('old', 'old@example.com', 'Old', '2026-01-02 03:04:05')");
    await ensureSchema(d1);
    expect(raw.prepare("SELECT email_verified_ms AS v FROM users WHERE id = 'old'").get()).toEqual({ v: Date.UTC(2026, 0, 2, 3, 4, 5) });
    raw.exec("INSERT INTO users (id, email, name) VALUES ('new', 'new@example.com', 'New')");
    expect(raw.prepare("SELECT email_verified_ms AS v FROM users WHERE id = 'new'").get()).toEqual({ v: null });
  });
});
