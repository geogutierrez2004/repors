/**
 * Restore user attribution for FILE_UPLOAD activities.
 *
 * Migration 004 anonymized all FILE_UPLOAD actions by setting user_id to NULL.
 * This migration recovers the user attribution by cross-referencing FILE_UPLOAD
 * activity entries with their corresponding audit entries (which retained user_id).
 *
 * For each FILE_UPLOAD entry with user_id=NULL, we find the matching FILE_UPLOAD
 * entry with the same filename (extracted from detail) and user_id!=NULL,
 * then copy the user_id over. This restores audit accountability while
 * preserving the dual-entry system (logActivity + logAudit).
 */
import type Database from 'better-sqlite3';

function tableExists(db: Database.Database, tableName: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { name: string } | undefined;
  return !!row;
}

function extractFilenameFromDetail(detail: string): string {
  // Handle both formats: "Uploaded filename" and "Uploaded filename (AES-256-GCM)"
  const match = detail.match(/^Uploaded\s+(.+?)(?:\s+\(AES-256-GCM\))?$/);
  return match ? match[1] : '';
}

export function up(db: Database.Database): void {
  if (!tableExists(db, 'activity_log')) return;

  // Get all FILE_UPLOAD entries with user_id=NULL
  const nullUserUploads = db
    .prepare(
      `SELECT id, detail, created_at FROM activity_log 
       WHERE action = 'FILE_UPLOAD' AND user_id IS NULL
       ORDER BY created_at ASC`,
    )
    .all() as Array<{ id: string; detail: string; created_at: string }>;

  // For each null-user FILE_UPLOAD, find the corresponding non-null user entry
  for (const entry of nullUserUploads) {
    const filename = extractFilenameFromDetail(entry.detail);
    if (!filename) continue; // Skip if we can't parse the filename

    // Find a FILE_UPLOAD entry with:
    // - same filename in detail
    // - user_id IS NOT NULL
    // - similar timestamp (within 5 seconds)
    const match = db
      .prepare(
        `SELECT user_id FROM activity_log 
         WHERE action = 'FILE_UPLOAD' 
         AND user_id IS NOT NULL
         AND detail LIKE ?
         AND ABS((julianday(created_at) - julianday(?))) * 24 * 60 * 60 < 5
         LIMIT 1`,
      )
      .get(
        `Uploaded ${filename}%`,
        entry.created_at,
      ) as { user_id: string } | undefined;

    if (match) {
      // Update the null-user entry with the found user_id
      db.prepare('UPDATE activity_log SET user_id = ? WHERE id = ?').run(match.user_id, entry.id);
    }
  }
}
