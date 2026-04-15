/**
 * SQLite database connection management.
 *
 * Uses better-sqlite3 in the main process only.
 * Supports swapping the database path for backup/restore workflows.
 */
import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { app } from 'electron';

let db: Database.Database | null = null;
let currentDbPath: string | null = null;

function getDefaultDbPath(): string {
  const appData =
    process.env['SCCFS_DATA_DIR'] ||
    (typeof app !== 'undefined' ? app.getPath('userData') : path.join(process.cwd(), '.sccfs-data'));
  const dir = path.join(appData, 'data');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'sccfs.db');
}

/**
 * Open (or return existing) database connection.
 * Applies pragmas for WAL mode and foreign keys.
 */
export function getDatabase(dbPath?: string): Database.Database {
  if (db) return db;
  const resolvedPath = dbPath ?? getDefaultDbPath();
  currentDbPath = resolvedPath;
  db = new Database(resolvedPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

/** Return the filesystem path of the current database file. */
export function getDatabasePath(): string | null {
  return currentDbPath;
}

/** Close the current database connection. */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
    currentDbPath = null;
  }
}

/**
 * Replace the internal db reference.
 * Used during testing or restore operations.
 */
export function setDatabase(newDb: Database.Database): void {
  if (db && db !== newDb) {
    db.close();
  }
  db = newDb;
}

