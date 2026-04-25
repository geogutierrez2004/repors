/**
 * Initial database schema migration.
 *
 * Creates all tables referenced in the data-model specification §5.1.
 */
import type Database from 'better-sqlite3';

export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL CHECK (role IN ('admin', 'staff')),
      is_active     INTEGER NOT NULL DEFAULT 1,
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until  INTEGER,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS shelves (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL UNIQUE,
      is_system   INTEGER NOT NULL DEFAULT 0,
      created_by  TEXT REFERENCES users(id),
      created_at  TEXT NOT NULL DEFAULT (datetime('now', 'utc')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now', 'utc'))
    );

    CREATE TABLE IF NOT EXISTS file_payloads (
      id            TEXT PRIMARY KEY,
      stored_name   TEXT NOT NULL,
      sha256        TEXT NOT NULL,
      size_bytes    INTEGER NOT NULL,
      is_encrypted  INTEGER NOT NULL DEFAULT 0,
      ref_count     INTEGER NOT NULL DEFAULT 1,
      created_at    TEXT NOT NULL DEFAULT (datetime('now', 'utc')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now', 'utc'))
    );

    CREATE TABLE IF NOT EXISTS files (
      id            TEXT PRIMARY KEY,
      original_name TEXT NOT NULL,
      original_extension TEXT,
      stored_name   TEXT NOT NULL,
      mime_type     TEXT,
      size_bytes    INTEGER NOT NULL,
      sha256        TEXT NOT NULL,
      shelf_id      TEXT NOT NULL REFERENCES shelves(id),
      uploaded_by   TEXT NOT NULL REFERENCES users(id),
      is_encrypted  INTEGER NOT NULL DEFAULT 0,
      payload_id    TEXT REFERENCES file_payloads(id),
      created_at    TEXT NOT NULL DEFAULT (datetime('now', 'utc')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now', 'utc'))
    );

    CREATE TABLE IF NOT EXISTS upload_history (
      id          TEXT PRIMARY KEY,
      file_id     TEXT NOT NULL REFERENCES files(id),
      user_id     TEXT NOT NULL REFERENCES users(id),
      status      TEXT NOT NULL CHECK (status IN ('pending','in_progress','completed','failed')),
      error       TEXT,
      started_at  TEXT NOT NULL DEFAULT (datetime('now', 'utc')),
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS downloads (
      id          TEXT PRIMARY KEY,
      file_id     TEXT NOT NULL REFERENCES files(id),
      user_id     TEXT NOT NULL REFERENCES users(id),
      downloaded_at TEXT NOT NULL DEFAULT (datetime('now', 'utc'))
    );

    CREATE TABLE IF NOT EXISTS activity_log (
      id          TEXT PRIMARY KEY,
      user_id     TEXT REFERENCES users(id),
      action      TEXT NOT NULL,
      detail      TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now', 'utc'))
    );

    CREATE TABLE IF NOT EXISTS storage_config (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS encryption_keys (
      id          TEXT PRIMARY KEY,
      file_id     TEXT NOT NULL UNIQUE REFERENCES files(id),
      salt        TEXT NOT NULL,
      iv          TEXT NOT NULL,
      auth_tag    TEXT NOT NULL,
      iterations  INTEGER NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now', 'utc'))
    );

    CREATE TABLE IF NOT EXISTS app_config (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_file_payloads_sha_size_enc
      ON file_payloads (sha256, size_bytes, is_encrypted);
  `);
}
