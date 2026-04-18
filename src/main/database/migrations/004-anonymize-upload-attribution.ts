import type Database from 'better-sqlite3';

const ANONYMOUS_UPLOAD_USER_ID = '00000000-0000-4000-a000-000000000010';
const ANONYMOUS_UPLOAD_USERNAME = '__system_upload__';

const FILE_ACTIONS = ['FILE_UPLOAD', 'FILE_DOWNLOAD', 'FILE_VIEW', 'FILE_DELETE', 'FILE_MOVE'] as const;

function tableExists(db: Database.Database, tableName: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { name: string } | undefined;
  return !!row;
}

function hasColumn(db: Database.Database, tableName: string, columnName: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return columns.some((column) => column.name === columnName);
}

function ensureAnonymousUploadUser(db: Database.Database): void {
  if (!tableExists(db, 'users')) return;

  const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(ANONYMOUS_UPLOAD_USER_ID);
  if (existing) return;

  db.prepare(
    `INSERT INTO users (id, username, password_hash, role, is_active, failed_attempts, locked_until)
     VALUES (?, ?, ?, 'staff', 0, 0, NULL)`,
  ).run(ANONYMOUS_UPLOAD_USER_ID, ANONYMOUS_UPLOAD_USERNAME, '!');
}

function anonymizeFiles(db: Database.Database): void {
  if (!tableExists(db, 'files')) return;
  if (!hasColumn(db, 'files', 'uploaded_by')) return;

  db.prepare('UPDATE files SET uploaded_by = ? WHERE uploaded_by IS NOT ?')
    .run(ANONYMOUS_UPLOAD_USER_ID, ANONYMOUS_UPLOAD_USER_ID);
}

function anonymizeActivity(db: Database.Database): void {
  if (!tableExists(db, 'activity_log')) return;

  const placeholders = FILE_ACTIONS.map(() => '?').join(', ');
  db.prepare(`UPDATE activity_log SET user_id = NULL WHERE action IN (${placeholders})`)
    .run(...FILE_ACTIONS);
}

export function up(db: Database.Database): void {
  ensureAnonymousUploadUser(db);
  anonymizeFiles(db);
  anonymizeActivity(db);
}
