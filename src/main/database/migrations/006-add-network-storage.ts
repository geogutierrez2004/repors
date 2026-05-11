/**
 * Adds network storage support.
 * 
 * Creates network_settings table for configuration and extends files/file_payloads
 * tables with storage_location tracking to support both local and network storage.
 */
import type Database from 'better-sqlite3';

export function up(db: Database.Database): void {
  // Create network_settings table
  db.exec(`
    CREATE TABLE IF NOT EXISTS network_settings (
      id            TEXT PRIMARY KEY,
      network_path  TEXT NOT NULL,
      enabled       INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL DEFAULT (datetime('now', 'utc')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now', 'utc'))
    );
  `);

  // Add storage_location column to file_payloads if it doesn't exist
  const payloadColumns = db.prepare('PRAGMA table_info(file_payloads)').all() as Array<{ name: string }>;
  const hasPayloadLocation = payloadColumns.some((col) => col.name === 'storage_location');
  if (!hasPayloadLocation) {
    db.exec(`
      ALTER TABLE file_payloads ADD COLUMN storage_location TEXT NOT NULL DEFAULT 'local'
        CHECK (storage_location IN ('local', 'network'));
    `);
  }

  // Add storage_location, synced_at, and sync_error columns to files if they don't exist
  const fileColumns = db.prepare('PRAGMA table_info(files)').all() as Array<{ name: string }>;
  
  const hasFileLocation = fileColumns.some((col) => col.name === 'storage_location');
  if (!hasFileLocation) {
    db.exec(`
      ALTER TABLE files ADD COLUMN storage_location TEXT NOT NULL DEFAULT 'local'
        CHECK (storage_location IN ('local', 'network'));
    `);
  }

  const hasSyncedAt = fileColumns.some((col) => col.name === 'synced_at');
  if (!hasSyncedAt) {
    db.exec(`
      ALTER TABLE files ADD COLUMN synced_at TEXT;
    `);
  }

  const hasSyncError = fileColumns.some((col) => col.name === 'sync_error');
  if (!hasSyncError) {
    db.exec(`
      ALTER TABLE files ADD COLUMN sync_error TEXT;
    `);
  }

  // Create index for efficient queries on storage_location
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_files_storage_location
      ON files (storage_location);
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_file_payloads_storage_location
      ON file_payloads (storage_location);
  `);
}
