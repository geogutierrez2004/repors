/**
 * Database initialization – runs migrations in order.
 */
import type Database from 'better-sqlite3';
import { up as initialSchema } from './migrations/001-initial-schema';
import { up as addFileExtension } from './migrations/002-add-file-extension';

const migrations = [initialSchema, addFileExtension];

export function runMigrations(db: Database.Database): void {
  // Create a migrations tracking table
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id        INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const applied = new Set(
    (db.prepare('SELECT id FROM _migrations').all() as { id: number }[]).map((r) => r.id),
  );

  const runInTransaction = db.transaction(() => {
    for (let i = 0; i < migrations.length; i++) {
      if (!applied.has(i)) {
        migrations[i](db);
        db.prepare('INSERT INTO _migrations (id) VALUES (?)').run(i);
      }
    }
  });

  runInTransaction();
}
