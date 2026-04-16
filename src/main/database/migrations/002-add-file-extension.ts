/**
 * Adds persistent file extension metadata for files.
 */
import type Database from 'better-sqlite3';
import path from 'node:path';
import { normalizeExtension, guessExtensionFromMime } from '../../utils/file-extension';

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
    const fromMime = guessExtensionFromMime(row.mime_type);
    const ext = fromOriginalName ?? fromStoredName ?? fromMime;
    if (ext) update.run(ext, row.id);
  }
}
