/**
 * Dashboard service.
 *
 * Provides aggregate stats, file CRUD (with Electron dialog integration),
 * shelf management, activity log queries, storage stats, backup/restore,
 * and session listing for the admin security dashboard.
 *
 * All DB access and filesystem I/O stay in the main process.
 */
import { v4 as uuidv4 } from 'uuid';
import type Database from 'better-sqlite3';
import BetterSqlite3 from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { dialog, BrowserWindow, app } from 'electron';
import { validateSession, listSessions } from './session.service';
import { destroySession } from './session.service';
import { requirePermission, Permission } from './rbac.service';
import { AuthError } from './auth.service';
import { SYSTEM_SHELVES, STORAGE_CONSTANTS, Role } from '../../shared/constants';
import type {
  FileRecord,
  ShelfRecord,
  ActivityRecord,
  StorageStats,
  DashboardStats,
  SessionInfo,
  PaginatedResult,
  UserRecord,
} from '../../shared/types';
import { getDatabasePath, setDatabase, getDatabase } from '../database/connection';
import { runMigrations } from '../database';

// ────────────────────────────────────────
// Helpers
// ────────────────────────────────────────

function requireAuth(sessionId: string) {
  const session = validateSession(sessionId);
  if (!session) throw new AuthError('INVALID_SESSION', 'Session expired or invalid');
  return session;
}

function getFilesDir(): string {
  const appData =
    process.env['SCCFS_DATA_DIR'] ||
    (typeof app !== 'undefined' ? app.getPath('userData') : path.join(process.cwd(), '.sccfs-data'));
  const dir = path.join(appData, 'files');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getInitialQuotaBytes(): number {
  try {
    const stat = fs.statfsSync(getFilesDir(), { bigint: true });
    const availableBytes = stat.bavail * stat.bsize;
    const autoQuota = (availableBytes * BigInt(STORAGE_CONSTANTS.AUTO_QUOTA_PERCENT)) / 100n;

    if (autoQuota <= 0n) return STORAGE_CONSTANTS.DEFAULT_QUOTA_BYTES;
    const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
    return Number(autoQuota > maxSafe ? maxSafe : autoQuota);
  } catch {
    return STORAGE_CONSTANTS.DEFAULT_QUOTA_BYTES;
  }
}

function getBackupsDir(): string {
  const appData =
    process.env['SCCFS_DATA_DIR'] ||
    (typeof app !== 'undefined' ? app.getPath('userData') : path.join(process.cwd(), '.sccfs-data'));
  const dir = path.join(appData, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function computeSha256(filePath: string): string {
  const hash = crypto.createHash('sha256');
  const data = fs.readFileSync(filePath);
  hash.update(data);
  return hash.digest('hex');
}

function countFilesRecursive(dirPath: string): number {
  if (!fs.existsSync(dirPath)) return 0;
  let count = 0;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) count += countFilesRecursive(fullPath);
    else if (entry.isFile()) count += 1;
  }
  return count;
}

function replaceDirectory(targetDir: string, sourceDir: string): void {
  const parentDir = path.dirname(targetDir);
  const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const stagingDir = path.join(parentDir, `.sccfs-stage-${nonce}`);
  const previousDir = path.join(parentDir, `.sccfs-prev-${nonce}`);

  fs.cpSync(sourceDir, stagingDir, { recursive: true });

  const hadTarget = fs.existsSync(targetDir);
  if (hadTarget) fs.renameSync(targetDir, previousDir);

  try {
    fs.renameSync(stagingDir, targetDir);
    if (hadTarget) fs.rmSync(previousDir, { recursive: true, force: true });
  } catch (e) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    if (hadTarget && fs.existsSync(previousDir) && !fs.existsSync(targetDir)) {
      fs.renameSync(previousDir, targetDir);
    }
    throw e;
  }
}

// ────────────────────────────────────────
// Dashboard service
// ────────────────────────────────────────

export class DashboardService {
  constructor(private db: Database.Database) {}

  // ── Seed system shelves ──────────────

  seedSystemShelves(): void {
    const admin = this.db.prepare('SELECT id FROM users WHERE role = ? LIMIT 1').get(Role.ADMIN) as
      | { id: string }
      | undefined;
    const createdBy = admin?.id ?? null;

    for (const name of SYSTEM_SHELVES) {
      const existing = this.db.prepare('SELECT id FROM shelves WHERE name = ?').get(name);
      if (!existing) {
        this.db
          .prepare('INSERT INTO shelves (id, name, is_system, created_by) VALUES (?, ?, 1, ?)')
          .run(uuidv4(), name, createdBy);
      }
    }

    // Seed default storage quota if not set
    const quota = this.db.prepare("SELECT value FROM storage_config WHERE key = 'quota_bytes'").get();
    if (!quota) {
      this.db
        .prepare("INSERT INTO storage_config (key, value) VALUES ('quota_bytes', ?)")
        .run(String(getInitialQuotaBytes()));
    }
  }

  // ── Dashboard stats ──────────────────

  getStats(sessionId: string): DashboardStats {
    requireAuth(sessionId);

    const activeSessions = listSessions().length;

    const fileRow = this.db
      .prepare('SELECT COUNT(*) as cnt, COALESCE(SUM(size_bytes), 0) as total FROM files')
      .get() as { cnt: number; total: number };

    const pendingRow = this.db
      .prepare("SELECT COUNT(*) as cnt FROM upload_history WHERE status IN ('pending','in_progress')")
      .get() as { cnt: number };

    const failedRow = this.db
      .prepare("SELECT COUNT(*) as cnt FROM upload_history WHERE status = 'failed' AND started_at >= datetime('now', '-1 day')")
      .get() as { cnt: number };

    const lockedRow = this.db
      .prepare(`SELECT COUNT(*) as cnt FROM users WHERE locked_until IS NOT NULL AND locked_until > ?`)
      .get(Date.now()) as { cnt: number };

    const recentActivity = this.db
      .prepare(
        `SELECT a.id, a.user_id, u.username, a.action, a.detail, a.created_at
         FROM activity_log a
         LEFT JOIN users u ON a.user_id = u.id
         ORDER BY a.created_at DESC
         LIMIT 15`,
      )
      .all() as ActivityRecord[];

    // Generate last 7 days with zeros for days without data
    const ops7dRaw = this.db
      .prepare(
        `SELECT date(started_at) as day,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as uploads,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failures
         FROM upload_history
         WHERE started_at >= datetime('now', '-6 days')
         GROUP BY day`,
      )
      .all() as Array<{ day: string; uploads: number; failures: number }>;

    const downloadsRaw = this.db
      .prepare(
        `SELECT date(downloaded_at) as day, COUNT(*) as downloads
         FROM downloads
         WHERE downloaded_at >= datetime('now', '-6 days')
         GROUP BY day`,
      )
      .all() as Array<{ day: string; downloads: number }>;

    const downloadsMap = new Map(downloadsRaw.map((r) => [r.day, r.downloads]));
    const opsMap = new Map(ops7dRaw.map((r) => [r.day, r]));

    const file_ops_7d: DashboardStats['file_ops_7d'] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const day = d.toISOString().slice(0, 10);
      const ops = opsMap.get(day);
      file_ops_7d.push({
        date: day,
        uploads: ops?.uploads ?? 0,
        downloads: downloadsMap.get(day) ?? 0,
        failures: ops?.failures ?? 0,
      });
    }

    return {
      active_sessions: activeSessions,
      total_files: fileRow.cnt,
      total_size_bytes: fileRow.total,
      pending_uploads: pendingRow.cnt,
      failed_uploads_24h: failedRow.cnt,
      locked_accounts: lockedRow.cnt,
      recent_activity: recentActivity,
      file_ops_7d,
    };
  }

  // ── Files ───────────────────────────

  listFiles(
    sessionId: string,
    opts: { shelfId?: string; search?: string; page: number; pageSize: number },
  ): PaginatedResult<FileRecord> {
    requireAuth(sessionId);

    const offset = (opts.page - 1) * opts.pageSize;
    const searchPattern = opts.search ? `%${opts.search}%` : null;

    let where = 'WHERE 1=1';
    const params: unknown[] = [];

    if (opts.shelfId) {
      where += ' AND f.shelf_id = ?';
      params.push(opts.shelfId);
    }
    if (searchPattern) {
      where += ' AND f.original_name LIKE ?';
      params.push(searchPattern);
    }

    const total = (
      this.db
        .prepare(
          `SELECT COUNT(*) as cnt FROM files f
           JOIN shelves s ON f.shelf_id = s.id
           LEFT JOIN users u ON f.uploaded_by = u.id
           ${where}`,
        )
        .get(...params) as { cnt: number }
    ).cnt;

    const items = this.db
      .prepare(
        `SELECT f.id, f.original_name, f.stored_name, f.mime_type, f.size_bytes, f.sha256,
                f.shelf_id, s.name as shelf_name,
                f.uploaded_by, COALESCE(u.username, '') as uploader_name,
                f.is_encrypted, f.created_at, f.updated_at
         FROM files f
         JOIN shelves s ON f.shelf_id = s.id
         LEFT JOIN users u ON f.uploaded_by = u.id
         ${where}
         ORDER BY f.created_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, opts.pageSize, offset) as FileRecord[];

    return { items, total, page: opts.page, pageSize: opts.pageSize };
  }

  async uploadFile(
    sessionId: string,
    shelfId: string,
    _encrypt: boolean,
    win: BrowserWindow,
  ): Promise<FileRecord> {
    const session = requireAuth(sessionId);
    requirePermission(session.role, Permission.FILE_UPLOAD);

    // Verify shelf exists
    const shelf = this.db.prepare('SELECT id FROM shelves WHERE id = ?').get(shelfId);
    if (!shelf) throw new AuthError('NOT_FOUND', 'Shelf not found');

    // Check quota before opening dialog
    const quotaRow = this.db
      .prepare("SELECT value FROM storage_config WHERE key = 'quota_bytes'")
      .get() as { value: string } | undefined;
    const quota = quotaRow ? Number(quotaRow.value) : STORAGE_CONSTANTS.DEFAULT_QUOTA_BYTES;
    const usedRow = this.db
      .prepare('SELECT COALESCE(SUM(size_bytes), 0) as total FROM files')
      .get() as { total: number };

    const { filePaths, canceled } = await dialog.showOpenDialog(win, {
      title: 'Select File to Upload',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'All Files', extensions: ['*'] }],
    });

    if (canceled || filePaths.length === 0) {
      throw new AuthError('CANCELLED', 'Upload cancelled');
    }

    const filesDir = getFilesDir();
    let lastUploaded!: FileRecord;

    for (const filePath of filePaths) {
      const stat = fs.statSync(filePath);

      if (stat.size > STORAGE_CONSTANTS.MAX_FILE_SIZE) {
        throw new AuthError(
          'FILE_TOO_LARGE',
          `File exceeds ${STORAGE_CONSTANTS.MAX_FILE_SIZE / (1024 ** 3)} GB limit: ${path.basename(filePath)}`,
        );
      }

      if (usedRow.total + stat.size > quota) {
        throw new AuthError('QUOTA_EXCEEDED', 'Storage quota exceeded');
      }

      const sha256 = computeSha256(filePath);
      const ext = path.extname(filePath);
      const storedName = `${uuidv4()}${ext}`;
      const destPath = path.join(filesDir, storedName);

      fs.copyFileSync(filePath, destPath);

      const fileId = uuidv4();
      const mime = this.guessMime(ext);

      this.db
        .prepare(
          `INSERT INTO files (id, original_name, stored_name, mime_type, size_bytes, sha256, shelf_id, uploaded_by, is_encrypted)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        )
        .run(fileId, path.basename(filePath), storedName, mime, stat.size, sha256, shelfId, session.userId);

      const uploadHistoryId = uuidv4();
      this.db
        .prepare(
          `INSERT INTO upload_history (id, file_id, user_id, status, completed_at)
           VALUES (?, ?, ?, 'completed', datetime('now'))`,
        )
        .run(uploadHistoryId, fileId, session.userId);

      this.logActivity(session.userId, 'FILE_UPLOAD', `Uploaded ${path.basename(filePath)}`);

      lastUploaded = this.getFileRecord(fileId);
      // Update running total
      usedRow.total += stat.size;
    }

    // Returns the last uploaded file record; callers refresh their own file list
    // to see all newly uploaded files when multiple files were selected.
    return lastUploaded;
  }

  async downloadFile(sessionId: string, fileId: string, win: BrowserWindow): Promise<void> {
    const session = requireAuth(sessionId);
    requirePermission(session.role, Permission.FILE_DOWNLOAD);

    const fileRow = this.db
      .prepare('SELECT * FROM files WHERE id = ?')
      .get(fileId) as (FileRecord & { stored_name: string }) | undefined;
    if (!fileRow) throw new AuthError('NOT_FOUND', 'File not found');

    const { filePath, canceled } = await dialog.showSaveDialog(win, {
      title: 'Save File',
      defaultPath: fileRow.original_name,
    });

    if (canceled || !filePath) throw new AuthError('CANCELLED', 'Download cancelled');

    const srcPath = path.join(getFilesDir(), fileRow.stored_name);
    if (!fs.existsSync(srcPath)) {
      throw new AuthError('FILE_MISSING', 'File data not found on disk');
    }

    fs.copyFileSync(srcPath, filePath);

    this.db
      .prepare('INSERT INTO downloads (id, file_id, user_id) VALUES (?, ?, ?)')
      .run(uuidv4(), fileId, session.userId);

    this.logActivity(session.userId, 'FILE_DOWNLOAD', `Downloaded ${fileRow.original_name}`);
  }

  deleteFile(sessionId: string, fileId: string): void {
    const session = requireAuth(sessionId);
    requirePermission(session.role, Permission.FILE_DELETE);

    const fileRow = this.db
      .prepare('SELECT * FROM files WHERE id = ?')
      .get(fileId) as (FileRecord & { stored_name: string }) | undefined;
    if (!fileRow) throw new AuthError('NOT_FOUND', 'File not found');

    const storedPath = path.join(getFilesDir(), fileRow.stored_name);
    if (fs.existsSync(storedPath)) {
      fs.unlinkSync(storedPath);
    }

    // Clean up dependent records before deleting file
    const deleteTransaction = this.db.transaction(() => {
      this.db.prepare('DELETE FROM upload_history WHERE file_id = ?').run(fileId);
      this.db.prepare('DELETE FROM downloads WHERE file_id = ?').run(fileId);
      this.db.prepare('DELETE FROM encryption_keys WHERE file_id = ?').run(fileId);
      this.db.prepare('DELETE FROM files WHERE id = ?').run(fileId);
    });
    deleteTransaction();

    this.logActivity(session.userId, 'FILE_DELETE', `Deleted ${fileRow.original_name}`);
  }

  moveFile(sessionId: string, fileId: string, targetShelfId: string): FileRecord {
    const session = requireAuth(sessionId);
    requirePermission(session.role, Permission.FILE_UPLOAD);

    const fileRow = this.db.prepare('SELECT id, original_name FROM files WHERE id = ?').get(fileId) as
      | { id: string; original_name: string }
      | undefined;
    if (!fileRow) throw new AuthError('NOT_FOUND', 'File not found');

    const shelf = this.db.prepare('SELECT id FROM shelves WHERE id = ?').get(targetShelfId);
    if (!shelf) throw new AuthError('NOT_FOUND', 'Target shelf not found');

    this.db
      .prepare("UPDATE files SET shelf_id = ?, updated_at = datetime('now') WHERE id = ?")
      .run(targetShelfId, fileId);

    this.logActivity(session.userId, 'FILE_MOVE', `Moved ${fileRow.original_name} to new shelf`);
    return this.getFileRecord(fileId);
  }

  // ── Shelves ──────────────────────────

  listShelves(sessionId: string): ShelfRecord[] {
    requireAuth(sessionId);

    return this.db
      .prepare(
        `SELECT s.id, s.name, s.is_system, s.created_by, s.created_at, s.updated_at,
                COUNT(f.id) as file_count,
                COALESCE(SUM(f.size_bytes), 0) as total_size_bytes
         FROM shelves s
         LEFT JOIN files f ON f.shelf_id = s.id
         GROUP BY s.id
         ORDER BY s.is_system DESC, s.name`,
      )
      .all() as ShelfRecord[];
  }

  createShelf(sessionId: string, name: string): ShelfRecord {
    const session = requireAuth(sessionId);
    requirePermission(session.role, Permission.SHELF_CREATE);

    const existing = this.db.prepare('SELECT id FROM shelves WHERE name = ? COLLATE NOCASE').get(name);
    if (existing) throw new AuthError('SHELF_EXISTS', 'A shelf with that name already exists');

    const shelfCount = (this.db.prepare('SELECT COUNT(*) as cnt FROM shelves').get() as { cnt: number }).cnt;
    if (shelfCount >= 50) throw new AuthError('SHELF_LIMIT', 'Maximum of 50 shelves reached');

    const id = uuidv4();
    this.db
      .prepare('INSERT INTO shelves (id, name, is_system, created_by) VALUES (?, ?, 0, ?)')
      .run(id, name, session.userId);

    this.logActivity(session.userId, 'SHELF_CREATE', `Created shelf "${name}"`);
    return this.getShelfRecord(id);
  }

  deleteShelf(sessionId: string, shelfId: string): void {
    const session = requireAuth(sessionId);
    requirePermission(session.role, Permission.SHELF_DELETE);

    const shelf = this.db.prepare('SELECT * FROM shelves WHERE id = ?').get(shelfId) as
      | { id: string; name: string; is_system: number }
      | undefined;
    if (!shelf) throw new AuthError('NOT_FOUND', 'Shelf not found');
    if (shelf.is_system) throw new AuthError('SYSTEM_SHELF', 'System shelves cannot be deleted');

    // Move files to Inbox
    const inbox = this.db.prepare('SELECT id FROM shelves WHERE name = ?').get('Inbox') as
      | { id: string }
      | undefined;
    if (inbox) {
      this.db.prepare("UPDATE files SET shelf_id = ?, updated_at = datetime('now') WHERE shelf_id = ?").run(inbox.id, shelfId);
    }

    this.db.prepare('DELETE FROM shelves WHERE id = ?').run(shelfId);
    this.logActivity(session.userId, 'SHELF_DELETE', `Deleted shelf "${shelf.name}"`);
  }

  renameShelf(sessionId: string, shelfId: string, name: string): ShelfRecord {
    const session = requireAuth(sessionId);
    requirePermission(session.role, Permission.SHELF_CREATE);

    const shelf = this.db.prepare('SELECT * FROM shelves WHERE id = ?').get(shelfId) as
      | { id: string; name: string; is_system: number }
      | undefined;
    if (!shelf) throw new AuthError('NOT_FOUND', 'Shelf not found');
    if (shelf.is_system) throw new AuthError('SYSTEM_SHELF', 'System shelves cannot be renamed');

    const existing = this.db
      .prepare('SELECT id FROM shelves WHERE name = ? COLLATE NOCASE AND id != ?')
      .get(name, shelfId);
    if (existing) throw new AuthError('SHELF_EXISTS', 'A shelf with that name already exists');

    this.db
      .prepare("UPDATE shelves SET name = ?, updated_at = datetime('now') WHERE id = ?")
      .run(name, shelfId);

    this.logActivity(session.userId, 'SHELF_RENAME', `Renamed shelf "${shelf.name}" to "${name}"`);
    return this.getShelfRecord(shelfId);
  }

  // ── Activity log ─────────────────────

  listActivity(
    sessionId: string,
    opts: {
      userId?: string;
      action?: string;
      dateFrom?: string;
      dateTo?: string;
      page: number;
      pageSize: number;
    },
  ): PaginatedResult<ActivityRecord> {
    const session = requireAuth(sessionId);

    let where = 'WHERE 1=1';
    const params: unknown[] = [];

    // Staff can only see their own activity
    if (session.role !== Role.ADMIN) {
      where += ' AND a.user_id = ?';
      params.push(session.userId);
    } else if (opts.userId) {
      where += ' AND a.user_id = ?';
      params.push(opts.userId);
    }

    if (opts.action) {
      where += ' AND a.action = ?';
      params.push(opts.action);
    }
    if (opts.dateFrom) {
      where += ' AND a.created_at >= ?';
      params.push(opts.dateFrom);
    }
    if (opts.dateTo) {
      where += ' AND a.created_at <= ?';
      params.push(opts.dateTo + 'T23:59:59');
    }

    const base = `FROM activity_log a LEFT JOIN users u ON a.user_id = u.id ${where}`;
    const total = (this.db.prepare(`SELECT COUNT(*) as cnt ${base}`).get(...params) as { cnt: number }).cnt;

    const offset = (opts.page - 1) * opts.pageSize;
    const items = this.db
      .prepare(
        `SELECT a.id, a.user_id, u.username, a.action, a.detail, a.created_at
         ${base}
         ORDER BY a.created_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, opts.pageSize, offset) as ActivityRecord[];

    return { items, total, page: opts.page, pageSize: opts.pageSize };
  }

  // ── Storage stats ─────────────────────

  getStorageStats(sessionId: string): StorageStats {
    requireAuth(sessionId);

    const quotaRow = this.db
      .prepare("SELECT value FROM storage_config WHERE key = 'quota_bytes'")
      .get() as { value: string } | undefined;
    const quota = quotaRow ? Number(quotaRow.value) : STORAGE_CONSTANTS.DEFAULT_QUOTA_BYTES;

    const totals = this.db
      .prepare('SELECT COUNT(*) as cnt, COALESCE(SUM(size_bytes), 0) as used FROM files')
      .get() as { cnt: number; used: number };

    const byShelf = this.db
      .prepare(
        `SELECT f.shelf_id, s.name as shelf_name,
                COALESCE(SUM(f.size_bytes), 0) as size_bytes,
                COUNT(f.id) as file_count
         FROM shelves s
         LEFT JOIN files f ON f.shelf_id = s.id
         GROUP BY s.id
         ORDER BY size_bytes DESC`,
      )
      .all() as StorageStats['by_shelf'];

    const trend = this.db
      .prepare(
        `SELECT date(created_at) as date,
                SUM(SUM(size_bytes)) OVER (ORDER BY date(created_at)) as cumulative_bytes
         FROM files
         WHERE created_at >= datetime('now', '-30 days')
         GROUP BY date(created_at)
         ORDER BY date`,
      )
      .all() as StorageStats['trend'];

    return {
      used_bytes: totals.used,
      quota_bytes: quota,
      file_count: totals.cnt,
      by_shelf: byShelf,
      trend,
    };
  }

  setQuota(sessionId: string, quotaBytes: number): void {
    const session = requireAuth(sessionId);
    requirePermission(session.role, Permission.STORAGE_BACKUP);

    this.db
      .prepare("INSERT OR REPLACE INTO storage_config (key, value) VALUES ('quota_bytes', ?)")
      .run(String(quotaBytes));
  }

  // ── Backup / restore ─────────────────

  async backup(sessionId: string, win: BrowserWindow): Promise<{ path: string }> {
    const session = requireAuth(sessionId);
    requirePermission(session.role, Permission.STORAGE_BACKUP);

    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
    const defaultName = `sccfs-backup-${timestamp}`;

    const { filePath, canceled } = await dialog.showSaveDialog(win, {
      title: 'Choose Backup Folder',
      defaultPath: path.join(getBackupsDir(), defaultName),
      buttonLabel: 'Create Backup Folder',
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });

    if (canceled || !filePath) throw new AuthError('CANCELLED', 'Backup cancelled');

    const backupDir = filePath;
    const backupDbPath = path.join(backupDir, 'sccfs.db');
    const backupFilesDir = path.join(backupDir, 'files');
    const backupMetaPath = path.join(backupDir, 'meta.json');

    const backupDirExisted = fs.existsSync(backupDir);
    if (backupDirExisted && fs.readdirSync(backupDir).length > 0) {
      throw new AuthError(
        'BACKUP_FAILED',
        'Target backup folder already exists and is not empty. Please choose a new folder.',
      );
    }

    try {
      fs.mkdirSync(backupDir, { recursive: true });

      // WAL checkpoint before backup
      this.db.pragma('wal_checkpoint(TRUNCATE)');
      await this.db.backup(backupDbPath);

      fs.mkdirSync(backupFilesDir, { recursive: true });
      fs.cpSync(getFilesDir(), backupFilesDir, { recursive: true });

      const totals = this.db
        .prepare('SELECT COUNT(*) as file_count, COALESCE(SUM(size_bytes), 0) as total_bytes FROM files')
        .get() as { file_count: number; total_bytes: number };

      const meta = {
        version: 1,
        createdAt: new Date().toISOString(),
        counts: {
          dbFiles: totals.file_count,
          blobFiles: countFilesRecursive(backupFilesDir),
          totalBytes: totals.total_bytes,
        },
        checksum: {
          sccfsDbSha256: computeSha256(backupDbPath),
        },
      };
      fs.writeFileSync(backupMetaPath, JSON.stringify(meta, null, 2), 'utf-8');
    } catch (e) {
      if (!backupDirExisted && fs.existsSync(backupDir)) {
        fs.rmSync(backupDir, { recursive: true, force: true });
      }
      throw e;
    }

    this.logActivity(session.userId, 'STORAGE_BACKUP', `Backup created at ${path.basename(backupDir)}`);
    return { path: backupDir };
  }

  async restore(sessionId: string, win: BrowserWindow): Promise<void> {
    const session = requireAuth(sessionId);
    requirePermission(session.role, Permission.STORAGE_RESTORE);

    const { filePaths, canceled } = await dialog.showOpenDialog(win, {
      title: 'Restore from Backup Folder',
      properties: ['openDirectory'],
    });

    if (canceled || !filePaths.length) throw new AuthError('CANCELLED', 'Restore cancelled');

    const backupDir = filePaths[0];
    const backupDbPath = path.join(backupDir, 'sccfs.db');
    const backupFilesDir = path.join(backupDir, 'files');

    if (!fs.existsSync(backupDbPath) || !fs.statSync(backupDbPath).isFile()) {
      throw new AuthError(
        'INVALID_BACKUP',
        'Selected folder is missing required sccfs.db file. Please select a valid backup folder.',
      );
    }
    if (!fs.existsSync(backupFilesDir) || !fs.statSync(backupFilesDir).isDirectory()) {
      throw new AuthError(
        'INVALID_BACKUP',
        'Selected folder is missing required files directory. Please select a valid backup folder.',
      );
    }

    // Validate backup by opening it read-only
    let testDb: Database.Database | null = null;
    try {
      testDb = new BetterSqlite3(backupDbPath, { readonly: true });
      testDb.prepare('SELECT 1 FROM users LIMIT 1').get();
    } catch {
      throw new AuthError(
        'INVALID_BACKUP',
        'The sccfs.db file in the selected folder is corrupted or invalid.',
      );
    } finally {
      testDb?.close();
    }

    const currentPath = getDatabasePath();
    if (!currentPath) throw new AuthError('INTERNAL_ERROR', 'Cannot determine database path');
    const currentFilesDir = getFilesDir();

    // Create a safety backup before overwriting in case restore fails
    const safetyRoot = fs.mkdtempSync(path.join(getBackupsDir(), 'pre-restore-'));
    const safetyBackupDb = path.join(safetyRoot, 'sccfs.db');
    const safetyBackupFiles = path.join(safetyRoot, 'files');
    this.db.close();
    fs.copyFileSync(currentPath, safetyBackupDb);
    fs.cpSync(currentFilesDir, safetyBackupFiles, { recursive: true });

    try {
      fs.copyFileSync(backupDbPath, currentPath);
      replaceDirectory(currentFilesDir, backupFilesDir);
    } catch {
      // Restore from safety backup on failure
      fs.copyFileSync(safetyBackupDb, currentPath);
      replaceDirectory(currentFilesDir, safetyBackupFiles);
      throw new AuthError('RESTORE_FAILED', 'Failed to overwrite database during restore');
    } finally {
      // Always try to clean up the safety backup
      fs.rm(safetyRoot, { recursive: true, force: true }, () => null);
    }

    const newDb = new BetterSqlite3(currentPath);
    newDb.pragma('journal_mode = WAL');
    newDb.pragma('foreign_keys = ON');
    setDatabase(newDb);
    this.db = newDb;
    runMigrations(newDb);

    this.logActivity(session.userId, 'STORAGE_RESTORE', `Backup restored from ${path.basename(backupDir)}`);
  }

  // ── Sessions (security dashboard) ────

  listActiveSessions(sessionId: string): SessionInfo[] {
    const session = requireAuth(sessionId);
    requirePermission(session.role, Permission.USER_LIST);

    const active = listSessions();
    const userIds = [...new Set(active.map((s) => s.userId))];

    const usernameMap = new Map<string, string>();
    if (userIds.length > 0) {
      const placeholders = userIds.map(() => '?').join(',');
      const users = this.db
        .prepare(`SELECT id, username FROM users WHERE id IN (${placeholders})`)
        .all(...userIds) as Array<{ id: string; username: string }>;
      for (const u of users) usernameMap.set(u.id, u.username);
    }

    return active.map((s) => ({
      sessionId: s.sessionId,
      userId: s.userId,
      username: usernameMap.get(s.userId) ?? s.userId,
      role: s.role,
      createdAt: s.createdAt,
      lastActivity: s.lastActivity,
    }));
  }

  terminateSession(callerSessionId: string, targetSessionId: string): void {
    const session = requireAuth(callerSessionId);
    requirePermission(session.role, Permission.USER_UPDATE);

    if (callerSessionId === targetSessionId) {
      throw new AuthError('SELF_TERMINATE', 'Cannot terminate your own session from the dashboard');
    }

    const destroyed = destroySession(targetSessionId);
    if (!destroyed) throw new AuthError('NOT_FOUND', 'Session not found or already expired');

    this.logActivity(session.userId, 'SESSION_TERMINATE', `Terminated session ${targetSessionId.slice(0, 8)}…`);
  }

  // ── Private helpers ──────────────────

  private getFileRecord(fileId: string): FileRecord {
    return this.db
      .prepare(
        `SELECT f.id, f.original_name, f.stored_name, f.mime_type, f.size_bytes, f.sha256,
                f.shelf_id, s.name as shelf_name,
                f.uploaded_by, COALESCE(u.username, '') as uploader_name,
                f.is_encrypted, f.created_at, f.updated_at
         FROM files f
         JOIN shelves s ON f.shelf_id = s.id
         LEFT JOIN users u ON f.uploaded_by = u.id
         WHERE f.id = ?`,
      )
      .get(fileId) as FileRecord;
  }

  private getShelfRecord(shelfId: string): ShelfRecord {
    return this.db
      .prepare(
        `SELECT s.id, s.name, s.is_system, s.created_by, s.created_at, s.updated_at,
                COUNT(f.id) as file_count,
                COALESCE(SUM(f.size_bytes), 0) as total_size_bytes
         FROM shelves s
         LEFT JOIN files f ON f.shelf_id = s.id
         WHERE s.id = ?
         GROUP BY s.id`,
      )
      .get(shelfId) as ShelfRecord;
  }

  private logActivity(userId: string, action: string, detail: string): void {
    this.db
      .prepare('INSERT INTO activity_log (id, user_id, action, detail) VALUES (?, ?, ?, ?)')
      .run(uuidv4(), userId, action, detail);
  }

  private guessMime(ext: string): string {
    const map: Record<string, string> = {
      '.pdf': 'application/pdf',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xls': 'application/vnd.ms-excel',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.txt': 'text/plain',
      '.csv': 'text/csv',
      '.zip': 'application/zip',
    };
    return map[ext.toLowerCase()] ?? 'application/octet-stream';
  }
}
