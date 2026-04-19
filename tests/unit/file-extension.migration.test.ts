import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/main/database';

describe('002-add-file-extension migration', () => {
  it('adds original_extension and backfills legacy rows when possible', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE files (
        id            TEXT PRIMARY KEY,
        original_name TEXT NOT NULL,
        stored_name   TEXT NOT NULL,
        mime_type     TEXT,
        size_bytes    INTEGER NOT NULL,
        sha256        TEXT NOT NULL,
        shelf_id      TEXT NOT NULL,
        uploaded_by   TEXT NOT NULL,
        is_encrypted  INTEGER NOT NULL DEFAULT 0,
        created_at    TEXT NOT NULL DEFAULT (datetime('now', 'utc')),
        updated_at    TEXT NOT NULL DEFAULT (datetime('now', 'utc'))
      );
      CREATE TABLE _migrations (
        id        INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now', 'utc'))
      );
      INSERT INTO _migrations (id) VALUES (0);
    `);

    db.prepare(
      `INSERT INTO files (id, original_name, stored_name, mime_type, size_bytes, sha256, shelf_id, uploaded_by, is_encrypted)
       VALUES ('a', 'legacy-name', 'uuid.txt', 'text/plain', 1, 'hash', 'shelf', 'user', 0)`,
    ).run();

    runMigrations(db);

    const columns = db.prepare('PRAGMA table_info(files)').all() as Array<{ name: string }>;
    expect(columns.some((column) => column.name === 'original_extension')).toBe(true);

    const row = db
      .prepare('SELECT original_extension FROM files WHERE id = ?')
      .get('a') as { original_extension: string | null };
    expect(row.original_extension).toBe('.txt');

    db.close();
  });
});
