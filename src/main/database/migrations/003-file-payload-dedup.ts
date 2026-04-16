import type Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';

export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS file_payloads (
      id            TEXT PRIMARY KEY,
      stored_name   TEXT NOT NULL,
      sha256        TEXT NOT NULL,
      size_bytes    INTEGER NOT NULL,
      is_encrypted  INTEGER NOT NULL DEFAULT 0,
      ref_count     INTEGER NOT NULL DEFAULT 1,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_file_payloads_sha_size_enc
      ON file_payloads (sha256, size_bytes, is_encrypted);
  `);

  const columns = db.prepare('PRAGMA table_info(files)').all() as Array<{ name: string }>;
  const hasPayloadId = columns.some((column) => column.name === 'payload_id');
  if (!hasPayloadId) {
    db.exec('ALTER TABLE files ADD COLUMN payload_id TEXT REFERENCES file_payloads(id)');
  }

  const files = db
    .prepare(
      `SELECT id, stored_name, sha256, size_bytes, is_encrypted
       FROM files
       WHERE payload_id IS NULL`,
    )
    .all() as Array<{
    id: string;
    stored_name: string;
    sha256: string;
    size_bytes: number;
    is_encrypted: number;
  }>;

  const findPayload = db.prepare(
    `SELECT id, ref_count
     FROM file_payloads
     WHERE stored_name = ?
       AND sha256 = ?
       AND size_bytes = ?
       AND is_encrypted = ?
     LIMIT 1`,
  );
  const insertPayload = db.prepare(
    `INSERT INTO file_payloads (id, stored_name, sha256, size_bytes, is_encrypted, ref_count)
     VALUES (?, ?, ?, ?, ?, 1)`,
  );
  const updatePayloadRef = db.prepare(
    "UPDATE file_payloads SET ref_count = ?, updated_at = datetime('now') WHERE id = ?",
  );
  const setFilePayload = db.prepare('UPDATE files SET payload_id = ? WHERE id = ?');

  for (const file of files) {
    const existing = findPayload.get(
      file.stored_name,
      file.sha256,
      file.size_bytes,
      file.is_encrypted ? 1 : 0,
    ) as { id: string; ref_count: number } | undefined;
    if (existing) {
      updatePayloadRef.run(existing.ref_count + 1, existing.id);
      setFilePayload.run(existing.id, file.id);
      continue;
    }

    const payloadId = uuidv4();
    insertPayload.run(payloadId, file.stored_name, file.sha256, file.size_bytes, file.is_encrypted ? 1 : 0);
    setFilePayload.run(payloadId, file.id);
  }
}
