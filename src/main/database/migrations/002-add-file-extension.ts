/**
 * Adds persistent file extension metadata for files.
 */
import type Database from 'better-sqlite3';
import path from 'node:path';

function normalizeExtension(ext: string): string | null {
  if (!ext || ext === '.') return null;
  const clean = ext.trim().toLowerCase();
  if (!clean.startsWith('.')) return null;
  if (clean.length < 2) return null;
  return clean;
}

function extensionFromMime(mimeType: string | null): string | null {
  if (!mimeType) return null;
  const map: Record<string, string> = {
    'application/pdf': '.pdf',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/vnd.ms-excel': '.xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'text/plain': '.txt',
    'text/csv': '.csv',
    'application/zip': '.zip',
  };
  return map[mimeType.toLowerCase()] ?? null;
}

export function up(db: Database.Database): void {
  const columns = db.prepare('PRAGMA table_info(files)').all() as Array<{ name: string }>;
  const hasOriginalExtension = columns.some((column) => column.name === 'original_extension');

  if (!hasOriginalExtension) {
    db.exec('ALTER TABLE files ADD COLUMN original_extension TEXT');
  }

  const rows = db
    .prepare(
      `SELECT id, original_name, stored_name, mime_type
       FROM files
       WHERE original_extension IS NULL OR TRIM(original_extension) = ''`,
    )
    .all() as Array<{ id: string; original_name: string; stored_name: string; mime_type: string | null }>;

  const update = db.prepare('UPDATE files SET original_extension = ? WHERE id = ?');
  for (const row of rows) {
    const fromOriginalName = normalizeExtension(path.extname(row.original_name));
    const fromStoredName = normalizeExtension(path.extname(row.stored_name));
    const fromMime = extensionFromMime(row.mime_type);
    const ext = fromOriginalName ?? fromStoredName ?? fromMime;
    if (ext) update.run(ext, row.id);
  }
}
