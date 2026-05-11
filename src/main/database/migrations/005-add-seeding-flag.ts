/**
 * Add seeding state tracking to prevent user deletion on app restart.
 * 
 * Stores a flag (_app_state.seeding_complete) that tracks whether
 * seedDefaultAdmin() has already been executed. This prevents the
 * consolidation logic from running on every app startup and deleting
 * extra users.
 */
import type Database from 'better-sqlite3';

export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _app_state (
      id          TEXT PRIMARY KEY,
      seeding_complete INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now', 'utc')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now', 'utc'))
    );

    INSERT OR IGNORE INTO _app_state (id, seeding_complete) 
    VALUES ('app', 0);
  `);
}
