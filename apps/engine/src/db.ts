import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export function openDatabase(filename: string): DatabaseSync {
  const db = new DatabaseSync(filename);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

export function migrate(db: DatabaseSync, directory: string): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )`);
  const files = readdirSync(directory)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const existing = db.prepare("SELECT id FROM schema_migrations WHERE id = ?").get(file) as { id: string } | undefined;
    if (existing) continue;
    const sql = readFileSync(path.join(directory, file), "utf8");
    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)").run(file, Date.now());
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}

export function tryAcquireLock(db: DatabaseSync, ownerId: string, now: number, staleMs: number): boolean {
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db.prepare("SELECT owner_id, heartbeat_ms FROM engine_lock WHERE id = 1").get() as
      | { owner_id: string; heartbeat_ms: number }
      | undefined;
    if (row && row.owner_id !== ownerId && now - row.heartbeat_ms < staleMs) {
      db.exec("ROLLBACK");
      return false;
    }
    db.prepare(
      `INSERT INTO engine_lock (id, owner_id, heartbeat_ms) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET owner_id = excluded.owner_id, heartbeat_ms = excluded.heartbeat_ms`,
    ).run(ownerId, now);
    db.exec("COMMIT");
    return true;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // The transaction may already be closed.
    }
    throw error;
  }
}

export function heartbeatLock(db: DatabaseSync, ownerId: string, now: number): void {
  db.prepare("UPDATE engine_lock SET heartbeat_ms = ? WHERE id = 1 AND owner_id = ?").run(now, ownerId);
}

export function releaseLock(db: DatabaseSync, ownerId: string): void {
  db.prepare("DELETE FROM engine_lock WHERE id = 1 AND owner_id = ?").run(ownerId);
}
