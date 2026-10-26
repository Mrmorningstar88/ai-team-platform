// Minimal D1 stand-in over node:sqlite, enough for the queries in src/worker.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

type Value = string | number | null;

class Statement {
  private params: Value[] = [];
  constructor(private db: DatabaseSync, private sql: string) {}
  bind(...params: Value[]) {
    this.params = params;
    return this;
  }
  async first<T>(): Promise<T | null> {
    return (this.db.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }
  async all<T>(): Promise<{ results: T[] }> {
    return { results: this.db.prepare(this.sql).all(...this.params) as T[] };
  }
  async run() {
    const r = this.db.prepare(this.sql).run(...this.params);
    return { meta: { changes: Number(r.changes) } };
  }
}

export function createTestDb(): { d1: D1Database; raw: DatabaseSync } {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON");
  const dir = join(import.meta.dirname, "..", "migrations");
  for (const file of readdirSync(dir).sort()) raw.exec(readFileSync(join(dir, file), "utf8"));
  const d1 = { prepare: (sql: string) => new Statement(raw, sql) } as unknown as D1Database;
  return { d1, raw };
}
