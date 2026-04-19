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
import { pipeline } from 'node:stream/promises';
import { dialog, BrowserWindow, app, shell } from 'electron';
import { validateSession, listSessions } from './session.service';
import { destroySession } from './session.service';
import { AuthError } from './auth.service';
import { SYSTEM_SHELVES, STORAGE_CONSTANTS } from '../../shared/constants';
import { DEFAULT_SECURITY_THRESHOLD_SETTINGS } from '../../shared/types';
import type {
  FileRecord,
  ShelfRecord,
  ActivityRecord,
  StorageStats,
  DashboardStats,
  SecurityIntegrityStats,
  SecurityThresholdSettings,
  SessionInfo,
  PaginatedResult,
  UserRecord,
  FileUploadResult,
  SourceHandlingMode,
  FileUploadItemResult,
  StagedUploadFile,
  SecureTempViewResult,
  SecureTempViewCleanupResult,
} from '../../shared/types';
import { normalizeExtension, guessExtensionFromMime } from '../utils/file-extension';

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

async function computeSha256Stream(filePath: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(filePath), hash);
  return hash.digest('hex');
}

function computeSha256Buffer(data: Buffer): string {
  const hash = crypto.createHash('sha256');
  hash.update(data);
  return hash.digest('hex');
}

function decodeBase64Strict(payload: string): Buffer {
  const normalized = payload.trim().replace(/-/g, '+').replace(/_/g, '/');
  if (!normalized || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized) || normalized.length % 4 === 1) {
    throw new AuthError('INVALID_UPLOAD_DATA', 'Invalid staged file payload.');
  }
  const decoded = Buffer.from(normalized, 'base64');
  const roundTripped = decoded.toString('base64').replace(/=+$/g, '');
  const expected = normalized.replace(/=+$/g, '');
  if (roundTripped !== expected) {
    throw new AuthError('INVALID_UPLOAD_DATA', 'Invalid staged file payload.');
  }
  return decoded;
}

async function copyStream(sourcePath: string, destinationPath: string): Promise<void> {
  await pipeline(fs.createReadStream(sourcePath), fs.createWriteStream(destinationPath));
}

const PBKDF2_ITERATIONS = 600_000;
const PBKDF2_KEY_LEN = 32;
const PBKDF2_DIGEST = 'sha512';
const GCM_IV_BYTES = 12;
const GCM_SALT_BYTES = 16;
const TEMP_PART_EXTENSION = '.part';
const SECURE_TEMP_VIEW_TTL_MS = 2 * 60 * 1000;
const MAX_SECURE_TEMP_CLEANUP_RETRIES = 3;
const ANONYMOUS_UPLOAD_USER_ID = '00000000-0000-4000-a000-000000000010';
const ANONYMOUS_UPLOAD_USERNAME = '__system_upload__';

function extractErrorCode(error: unknown): string {
  return typeof error === 'object' && error && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : '';
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

function makeTempPartPath(basePath: string): string {
  return `${basePath}${TEMP_PART_EXTENSION}.${uuidv4()}`;
}

function sanitizeFileName(name: string): string {
  const baseName = name.split(/[\\/]/).pop()?.trim() ?? '';
  const sanitized = baseName
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/[. ]+$/g, '');
  return sanitized || 'unnamed-file';
}

// ────────────────────────────────────────
// Dashboard service
// ────────────────────────────────────────

export class DashboardService {
  private secureViewCleanupTimers = new Map<string, NodeJS.Timeout>();
  private secureViewCleanupRetryCount = new Map<string, number>();
  private secureViewTempById = new Map<string, { tempDir: string; tempFilePath: string }>();

  constructor(
    private db: Database.Database,
    private readonly restoreExecutor?: (request: {
      backupDir: string;
      backupDbPath: string;
      backupFilesDir: string;
      actorUserId: string;
    }) => Promise<void>,
  ) {}

  // ── Seed system shelves ──────────────

  seedSystemShelves(): void {
    const firstUser = this.db.prepare('SELECT id FROM users ORDER BY rowid ASC LIMIT 1').get() as
      | { id: string }
      | undefined;
    const createdBy = firstUser?.id ?? null;

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

    const hasSourceModeDefault = this.db
      .prepare("SELECT key FROM app_config WHERE key = 'upload_source_mode_default'")
      .get();
    if (!hasSourceModeDefault) {
      this.db
        .prepare("INSERT INTO app_config (key, value) VALUES ('upload_source_mode_default', 'ask_each_time')")
        .run();
    }

    const hasPermanentDeleteFlag = this.db
      .prepare("SELECT key FROM app_config WHERE key = 'upload_allow_permanent_delete'")
      .get();
    if (!hasPermanentDeleteFlag) {
      this.db
        .prepare("INSERT INTO app_config (key, value) VALUES ('upload_allow_permanent_delete', '0')")
        .run();
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

  getSecurityIntegrityStats(sessionId: string): SecurityIntegrityStats {
    requireAuth(sessionId);

    const fileSecurity = this.db
      .prepare(
        `SELECT COUNT(*) as total,
                SUM(CASE WHEN is_encrypted = 1 THEN 1 ELSE 0 END) as encrypted,
                SUM(CASE WHEN is_encrypted = 0 THEN 1 ELSE 0 END) as unencrypted,
                COALESCE(SUM(size_bytes), 0) as used_bytes
         FROM files`,
      )
      .get() as { total: number; encrypted: number | null; unencrypted: number | null; used_bytes: number };

    const quotaRow = this.db
      .prepare("SELECT value FROM storage_config WHERE key = 'quota_bytes'")
      .get() as { value: string } | undefined;
    const quotaBytes = quotaRow ? Number(quotaRow.value) : STORAGE_CONSTANTS.DEFAULT_QUOTA_BYTES;
    const storageUsedPercent = quotaBytes > 0
      ? (fileSecurity.used_bytes / quotaBytes) * 100
      : 0;

    const pendingUploads = this.db
      .prepare("SELECT COUNT(*) as cnt FROM upload_history WHERE status IN ('pending','in_progress')")
      .get() as { cnt: number };

    const failedUploads24h = this.db
      .prepare("SELECT COUNT(*) as cnt FROM upload_history WHERE status = 'failed' AND started_at >= datetime('now', '-1 day')")
      .get() as { cnt: number };

    const failedUploads7d = this.db
      .prepare("SELECT COUNT(*) as cnt FROM upload_history WHERE status = 'failed' AND started_at >= datetime('now', '-7 day')")
      .get() as { cnt: number };

    const failureReasons = this.db
      .prepare(
        `SELECT COALESCE(NULLIF(error, ''), 'UNKNOWN') as reason, COUNT(*) as count
         FROM upload_history
         WHERE status = 'failed' AND started_at >= datetime('now', '-7 day')
         GROUP BY reason
         ORDER BY count DESC
         LIMIT 8`,
      )
      .all() as Array<{ reason: string; count: number }>;

    const lockoutRows = this.db
      .prepare(
        `SELECT strftime('%H', created_at) as hour, COUNT(*) as count
         FROM activity_log
         WHERE action IN ('ACCOUNT_LOCKED', 'LOGIN_FAILED')
           AND created_at >= datetime('now', '-1 day')
         GROUP BY hour
         ORDER BY hour ASC`,
      )
      .all() as Array<{ hour: string; count: number }>;
    const lockoutMap = new Map(lockoutRows.map((row) => [Number(row.hour), row.count]));

    const threatActivityByHour: SecurityIntegrityStats['threat_activity_by_hour'] =
      Array.from({ length: 24 }, (_unused, hour) => ({
        hour: `${String(hour).padStart(2, '0')}:00`,
        count: lockoutMap.get(hour) ?? 0,
      }));

    const lockoutEvents24h = lockoutRows.reduce((total, row) => total + row.count, 0);

    const backupRow = this.db
      .prepare("SELECT MAX(created_at) as last_backup_at FROM activity_log WHERE action = 'STORAGE_BACKUP'")
      .get() as { last_backup_at: string | null };

    const criticalEvents = this.db
      .prepare(
        `SELECT a.id, a.user_id, u.username, a.action, a.detail, a.created_at
         FROM activity_log a
         LEFT JOIN users u ON a.user_id = u.id
         WHERE a.action IN ('FILE_DELETE', 'STORAGE_RESTORE', 'ACCOUNT_LOCKED', 'LOGIN_FAILED')
         ORDER BY a.created_at DESC
         LIMIT 12`,
      )
      .all() as ActivityRecord[];

    return {
      total_files: fileSecurity.total,
      encrypted_files: fileSecurity.encrypted ?? 0,
      unencrypted_files: fileSecurity.unencrypted ?? 0,
      pending_uploads: pendingUploads.cnt,
      failed_uploads_24h: failedUploads24h.cnt,
      failed_uploads_7d: failedUploads7d.cnt,
      storage_used_bytes: fileSecurity.used_bytes,
      storage_quota_bytes: quotaBytes,
      storage_used_percent: storageUsedPercent,
      lockout_events_24h: lockoutEvents24h,
      last_backup_at: backupRow.last_backup_at,
      upload_failures_by_reason: failureReasons,
      threat_activity_by_hour: threatActivityByHour,
      critical_events: criticalEvents,
    };
  }

  getSecurityThresholdSettings(sessionId: string): SecurityThresholdSettings {
    requireAuth(sessionId);

    const row = this.db
      .prepare("SELECT value FROM app_config WHERE key = 'security_threshold_settings'")
      .get() as { value: string } | undefined;

    if (!row?.value) {
      return { ...DEFAULT_SECURITY_THRESHOLD_SETTINGS };
    }

    try {
      const parsed = JSON.parse(row.value) as Partial<SecurityThresholdSettings>;
      return this.normalizeSecurityThresholdSettings(parsed);
    } catch {
      return { ...DEFAULT_SECURITY_THRESHOLD_SETTINGS };
    }
  }

  setSecurityThresholdSettings(
    sessionId: string,
    settings: SecurityThresholdSettings,
  ): SecurityThresholdSettings {
    requireAuth(sessionId);

    const normalized = this.normalizeSecurityThresholdSettings(settings);

    this.db
      .prepare("INSERT OR REPLACE INTO app_config (key, value) VALUES ('security_threshold_settings', ?)")
      .run(JSON.stringify(normalized));

    return normalized;
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
           ${where}`,
        )
        .get(...params) as { cnt: number }
    ).cnt;

    const items = this.db
      .prepare(
        `SELECT f.id, f.original_name, f.stored_name, f.mime_type, f.size_bytes, f.sha256,
                f.original_extension,
                f.shelf_id, s.name as shelf_name,
                f.is_encrypted, f.created_at, f.updated_at
         FROM files f
         JOIN shelves s ON f.shelf_id = s.id
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
    encrypt: boolean,
    encryptionPassword: string | undefined,
    sourceHandlingMode: SourceHandlingMode,
    confirmPermanentDelete: boolean,
    win: BrowserWindow,
    filePaths?: string[],
    stagedFiles?: StagedUploadFile[],
  ): Promise<FileUploadResult> {
    const session = requireAuth(sessionId);

    // Verify shelf exists
    const shelf = this.db.prepare('SELECT id FROM shelves WHERE id = ?').get(shelfId);
    if (!shelf) throw new AuthError('NOT_FOUND', 'Shelf not found');

    // Check quota before selecting files
    const quotaRow = this.db
      .prepare("SELECT value FROM storage_config WHERE key = 'quota_bytes'")
      .get() as { value: string } | undefined;
    const quota = quotaRow ? Number(quotaRow.value) : STORAGE_CONSTANTS.DEFAULT_QUOTA_BYTES;
    const usedRow = this.db
      .prepare('SELECT COALESCE(SUM(size_bytes), 0) as total FROM files')
      .get() as { total: number };

    const selectedStagedFiles = stagedFiles ?? [];
    let selectedFilePaths = filePaths;
    if (selectedStagedFiles.length === 0 && (!selectedFilePaths || selectedFilePaths.length === 0)) {
      const selected = await dialog.showOpenDialog(win, {
        title: 'Select File to Upload',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'All Files', extensions: ['*'] }],
      });
      if (selected.canceled || selected.filePaths.length === 0) {
        throw new AuthError('CANCELLED', 'Upload cancelled');
      }
      selectedFilePaths = selected.filePaths;
    }

    const uploadSources: Array<
      | { kind: 'path'; sourcePath: string; sourceName: string }
      | { kind: 'staged'; sourcePath: string; sourceName: string; bytes: Buffer; mimeType: string | null }
    > = [];
    if (selectedStagedFiles.length > 0) {
      for (const stagedFile of selectedStagedFiles) {
        const sourceName = stagedFile.source_name.trim();
        if (!sourceName) {
          throw new AuthError('INVALID_UPLOAD_DATA', 'Invalid staged file name.');
        }
        const bytes = decodeBase64Strict(stagedFile.content_base64);
        if (bytes.length !== stagedFile.size_bytes) {
          throw new AuthError('INVALID_UPLOAD_DATA', `Staged file "${sourceName}" size mismatch.`);
        }
        if (bytes.length === 0) {
          throw new AuthError('INVALID_UPLOAD_DATA', `Staged file "${sourceName}" is empty.`);
        }
        uploadSources.push({
          kind: 'staged',
          sourcePath: sourceName,
          sourceName,
          bytes,
          mimeType: stagedFile.mime_type ?? null,
        });
      }
    } else if (selectedFilePaths) {
      for (const selectedPath of selectedFilePaths) {
        uploadSources.push({
          kind: 'path',
          sourcePath: selectedPath,
          sourceName: path.basename(selectedPath),
        });
      }
    }
    if (uploadSources.length === 0) {
      throw new AuthError('CANCELLED', 'Upload cancelled');
    }

    const filesDir = getFilesDir();
    const resultItems: FileUploadItemResult[] = [];
    const mode: SourceHandlingMode = sourceHandlingMode === 'ask_each_time' ? 'keep_original' : sourceHandlingMode;
    const normalizedEncryptionPassword = encryptionPassword?.trim();

    this.ensureAnonymousUploadUser();

    if (encrypt && !normalizedEncryptionPassword) {
      throw new AuthError('ENCRYPTION_PASSWORD_REQUIRED', 'Encryption password is required for encrypted upload.');
    }

    for (const uploadSource of uploadSources) {
      const sourceName = uploadSource.sourceName;
      const sourcePath = uploadSource.sourcePath;
      let rollbackContext:
        | {
            fileId: string;
            payloadId: string;
            storedName: string;
            reusedPayload: boolean;
            payloadWrittenToDisk: boolean;
          }
        | undefined;
      const item: FileUploadItemResult = {
        source_path: sourcePath,
        source_name: sourceName,
        success: false,
        removed_original: false,
        mode,
      };
      try {
        const sourceSize = uploadSource.kind === 'path' ? fs.statSync(sourcePath).size : uploadSource.bytes.length;

        if (sourceSize > STORAGE_CONSTANTS.MAX_FILE_SIZE) {
          throw new AuthError(
            'FILE_TOO_LARGE',
            `File exceeds ${STORAGE_CONSTANTS.MAX_FILE_SIZE / (1024 ** 3)} GB limit: ${sourceName}`,
          );
        }

        if (usedRow.total + sourceSize > quota) {
          throw new AuthError('QUOTA_EXCEEDED', 'Storage quota exceeded');
        }

        const sha256 = uploadSource.kind === 'path'
          ? await computeSha256Stream(sourcePath)
          : computeSha256Buffer(uploadSource.bytes);
        const ext = path.extname(sourceName);
        const originalExtension = normalizeExtension(ext);
        const mime = uploadSource.kind === 'staged'
          ? uploadSource.mimeType ?? this.guessMime(ext)
          : this.guessMime(ext);
        const fileId = uuidv4();

        let storedName: string;
        let payloadId: string;
        let encryptionMeta:
          | {
              salt: string;
              iv: string;
              authTag: string;
              iterations: number;
            }
          | undefined;
        let reusedPayload = false;
        let payloadWrittenToDisk = false;

        if (!encrypt) {
          const existingPayload = this.db
            .prepare(
              `SELECT id, stored_name
               FROM file_payloads
               WHERE sha256 = ? AND size_bytes = ? AND is_encrypted = 0
               ORDER BY created_at ASC
               LIMIT 1`,
            )
            .get(sha256, sourceSize) as { id: string; stored_name: string } | undefined;

          if (existingPayload && fs.existsSync(path.join(filesDir, existingPayload.stored_name))) {
            storedName = existingPayload.stored_name;
            payloadId = existingPayload.id;
            reusedPayload = true;
          } else {
            storedName = `${uuidv4()}${ext}`;
            payloadId = uuidv4();
            const targetPath = path.join(filesDir, storedName);
            if (uploadSource.kind === 'path') {
              await copyStream(sourcePath, targetPath);
            } else {
              fs.writeFileSync(targetPath, uploadSource.bytes);
            }
            payloadWrittenToDisk = true;
          }
        } else {
          storedName = `${uuidv4()}${ext}`;
          payloadId = uuidv4();
          const iterations = PBKDF2_ITERATIONS;
          const salt = crypto.randomBytes(GCM_SALT_BYTES);
          const iv = crypto.randomBytes(GCM_IV_BYTES);
          const key = this.deriveFileKey(normalizedEncryptionPassword as string, salt, iterations);
          const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
          const finalPath = path.join(filesDir, storedName);
          const tempPath = makeTempPartPath(finalPath);

          try {
            if (uploadSource.kind === 'path') {
              await pipeline(
                fs.createReadStream(sourcePath),
                cipher,
                fs.createWriteStream(tempPath),
              );
            } else {
              const encrypted = Buffer.concat([cipher.update(uploadSource.bytes), cipher.final()]);
              fs.writeFileSync(tempPath, encrypted);
            }
            await fs.promises.rename(tempPath, finalPath);
            payloadWrittenToDisk = true;
          } catch (e) {
            if (fs.existsSync(tempPath)) {
              fs.rmSync(tempPath, { force: true });
            }
            throw e;
          }

          encryptionMeta = {
            salt: salt.toString('base64'),
            iv: iv.toString('base64'),
            authTag: cipher.getAuthTag().toString('base64'),
            iterations,
          };
        }

        const persistTransaction = this.db.transaction(() => {
          if (reusedPayload) {
            this.db
              .prepare("UPDATE file_payloads SET ref_count = ref_count + 1, updated_at = datetime('now') WHERE id = ?")
              .run(payloadId);
          } else {
            this.db
              .prepare(
                `INSERT INTO file_payloads (id, stored_name, sha256, size_bytes, is_encrypted, ref_count)
                 VALUES (?, ?, ?, ?, ?, 1)`,
              )
              .run(payloadId, storedName, sha256, sourceSize, encrypt ? 1 : 0);
          }

          this.db
            .prepare(
              `INSERT INTO files (id, original_name, original_extension, stored_name, mime_type, size_bytes, sha256, shelf_id, uploaded_by, is_encrypted, payload_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              fileId,
              sourceName,
              originalExtension,
              storedName,
              mime,
              sourceSize,
              sha256,
              shelfId,
              ANONYMOUS_UPLOAD_USER_ID,
              encrypt ? 1 : 0,
              payloadId,
            );

          if (encrypt && encryptionMeta) {
            this.db
              .prepare(
                `INSERT INTO encryption_keys (id, file_id, salt, iv, auth_tag, iterations)
                 VALUES (?, ?, ?, ?, ?, ?)`,
              )
              .run(uuidv4(), fileId, encryptionMeta.salt, encryptionMeta.iv, encryptionMeta.authTag, encryptionMeta.iterations);
          }

          this.db
            .prepare(
              `INSERT INTO upload_history (id, file_id, user_id, status, completed_at)
               VALUES (?, ?, ?, 'completed', datetime('now'))`,
            )
            .run(uuidv4(), fileId, session.userId);
        });
        persistTransaction();

        rollbackContext = {
          fileId,
          payloadId,
          storedName,
          reusedPayload,
          payloadWrittenToDisk,
        };

        await this.assertStoredUploadIntegrity(
          fileId,
          path.join(filesDir, storedName),
          sha256,
          encrypt,
          normalizedEncryptionPassword,
        );

        if (mode === 'move_to_system') {
          item.removed_original = uploadSource.kind === 'path'
            ? await this.removeOriginalFileSafely(sourcePath, confirmPermanentDelete)
            : false;
        }

        this.logActivity(
          null,
          'FILE_UPLOAD',
          encrypt ? `Uploaded encrypted ${sourceName}` : `Uploaded ${sourceName}`,
        );

        item.success = true;
        item.file = this.getFileRecord(fileId);
        usedRow.total += sourceSize;
      } catch (e) {
        if (e instanceof AuthError && e.code.startsWith('UPLOAD_INTEGRITY_') && rollbackContext) {
          try {
            this.rollbackUploadPersistence(rollbackContext);
          } catch {
            // best-effort rollback
          }
        }
        if (e instanceof AuthError) {
          item.error = { code: e.code, message: e.message };
        } else {
          item.error = { code: 'UPLOAD_FAILED', message: e instanceof Error ? e.message : 'Upload failed' };
        }
      }
      resultItems.push(item);
    }

    return { files: resultItems };
  }

  async downloadFile(
    sessionId: string,
    fileId: string,
    decryptionPassword: string | undefined,
    win: BrowserWindow,
  ): Promise<void> {
    const session = requireAuth(sessionId);

    const fileRow = this.db
      .prepare('SELECT * FROM files WHERE id = ?')
      .get(fileId) as (FileRecord & { stored_name: string }) | undefined;
    if (!fileRow) throw new AuthError('NOT_FOUND', 'File not found');

    const { filePath, canceled } = await dialog.showSaveDialog(win, {
      title: 'Save File',
      defaultPath: this.resolveDownloadFileName(fileRow),
    });

    if (canceled || !filePath) throw new AuthError('CANCELLED', 'Download cancelled');

    const srcPath = path.join(getFilesDir(), fileRow.stored_name);
    if (!fs.existsSync(srcPath)) {
      throw new AuthError('FILE_MISSING', 'File data not found on disk');
    }

    if (!fileRow.is_encrypted) {
      await copyStream(srcPath, filePath);
    } else {
      const normalizedPassword = decryptionPassword?.trim();
      if (!normalizedPassword) {
        throw new AuthError('DECRYPTION_PASSWORD_REQUIRED', 'Password is required to decrypt this file.');
      }
      await this.decryptEncryptedPayloadToFile(fileId, srcPath, filePath, normalizedPassword);
    }

    this.db
      .prepare('INSERT INTO downloads (id, file_id, user_id) VALUES (?, ?, ?)')
      .run(uuidv4(), fileId, session.userId);

    this.logActivity(null, 'FILE_DOWNLOAD', `Downloaded ${fileRow.original_name}`);
  }

  async viewEncryptedFile(
    sessionId: string,
    fileId: string,
    decryptionPassword: string,
  ): Promise<SecureTempViewResult> {
    requireAuth(sessionId);

    const fileRow = this.db
      .prepare('SELECT * FROM files WHERE id = ?')
      .get(fileId) as (FileRecord & { stored_name: string }) | undefined;
    if (!fileRow) throw new AuthError('NOT_FOUND', 'File not found');
    if (!fileRow.is_encrypted) {
      throw new AuthError('FILE_NOT_ENCRYPTED', 'Only encrypted files can be opened with secure view');
    }
    const normalizedPassword = decryptionPassword?.trim();
    if (!normalizedPassword) {
      throw new AuthError('DECRYPTION_PASSWORD_REQUIRED', 'Password is required to decrypt this file.');
    }

    const srcPath = path.join(getFilesDir(), fileRow.stored_name);
    if (!fs.existsSync(srcPath)) {
      throw new AuthError('FILE_MISSING', 'File data not found on disk');
    }

    const { tempDir, tempFilePath } = await this.createSecureTempViewTarget(fileRow);
    const viewId = uuidv4();
    try {
      await this.decryptEncryptedPayloadToFile(fileId, srcPath, tempFilePath, normalizedPassword);
    } catch (error) {
      this.removeSecureTempView(viewId, tempDir);
      if (error instanceof AuthError) {
        throw error;
      }
      throw new AuthError('SECURE_VIEW_FAILED', 'Could not open secure temp view for this file');
    }

    const contentBase64 = fs.readFileSync(tempFilePath).toString('base64');
    this.secureViewTempById.set(viewId, { tempDir, tempFilePath });
    this.scheduleSecureTempViewCleanup(viewId, tempDir);
    this.logActivity(null, 'FILE_VIEW', `Viewed encrypted ${fileRow.original_name}`);
    return {
      viewId,
      fileName: this.resolveDownloadFileName(fileRow),
      mimeType: fileRow.mime_type,
      contentBase64,
      cleanupAfterMs: SECURE_TEMP_VIEW_TTL_MS,
    };
  }

  cleanupSecureTempView(sessionId: string, viewId: string): SecureTempViewCleanupResult {
    requireAuth(sessionId);
    const entry = this.secureViewTempById.get(viewId);
    if (!entry) {
      return { deleted: false };
    }
    this.removeSecureTempView(viewId, entry.tempDir);
    return { deleted: true };
  }

  cleanupSecureTempViews(): void {
    for (const [viewId, timer] of [...this.secureViewCleanupTimers.entries()]) {
      clearTimeout(timer);
      const entry = this.secureViewTempById.get(viewId);
      this.removeSecureTempView(viewId, entry?.tempDir);
    }
    this.secureViewCleanupTimers.clear();
    this.secureViewCleanupRetryCount.clear();
    this.secureViewTempById.clear();
  }

  deleteFile(sessionId: string, fileId: string): void {
    requireAuth(sessionId);

    const fileRow = this.db
      .prepare('SELECT * FROM files WHERE id = ?')
      .get(fileId) as (FileRecord & { stored_name: string; payload_id: string | null }) | undefined;
    if (!fileRow) throw new AuthError('NOT_FOUND', 'File not found');

    // Clean up dependent records before deleting file
    let payloadToDeletePath: string | null = null;
    const deleteTransaction = this.db.transaction(() => {
      this.db.prepare('DELETE FROM upload_history WHERE file_id = ?').run(fileId);
      this.db.prepare('DELETE FROM downloads WHERE file_id = ?').run(fileId);
      this.db.prepare('DELETE FROM encryption_keys WHERE file_id = ?').run(fileId);
      this.db.prepare('DELETE FROM files WHERE id = ?').run(fileId);

      if (fileRow.payload_id) {
        const payload = this.db
          .prepare('SELECT id, stored_name, ref_count FROM file_payloads WHERE id = ?')
          .get(fileRow.payload_id) as { id: string; stored_name: string; ref_count: number } | undefined;

        if (payload) {
          if (payload.ref_count <= 1) {
            this.db.prepare('DELETE FROM file_payloads WHERE id = ?').run(payload.id);
            payloadToDeletePath = path.join(getFilesDir(), payload.stored_name);
          } else {
            this.db
              .prepare("UPDATE file_payloads SET ref_count = ref_count - 1, updated_at = datetime('now') WHERE id = ?")
              .run(payload.id);
          }
        }
      } else {
        payloadToDeletePath = path.join(getFilesDir(), fileRow.stored_name);
      }
    });
    deleteTransaction();

    if (payloadToDeletePath && fs.existsSync(payloadToDeletePath)) {
      fs.unlinkSync(payloadToDeletePath);
    }

    this.logActivity(null, 'FILE_DELETE', `Deleted ${fileRow.original_name}`);
  }

  moveFile(sessionId: string, fileId: string, targetShelfId: string): FileRecord {
    requireAuth(sessionId);

    const fileRow = this.db.prepare('SELECT id, original_name FROM files WHERE id = ?').get(fileId) as
      | { id: string; original_name: string }
      | undefined;
    if (!fileRow) throw new AuthError('NOT_FOUND', 'File not found');

    const shelf = this.db.prepare('SELECT id FROM shelves WHERE id = ?').get(targetShelfId);
    if (!shelf) throw new AuthError('NOT_FOUND', 'Target shelf not found');

    this.db
      .prepare("UPDATE files SET shelf_id = ?, updated_at = datetime('now') WHERE id = ?")
      .run(targetShelfId, fileId);

    this.logActivity(null, 'FILE_MOVE', `Moved ${fileRow.original_name} to new shelf`);
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
    requireAuth(sessionId);

    let where = 'WHERE 1=1';
    const params: unknown[] = [];

    if (opts.userId) {
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
    requireAuth(sessionId);

    this.db
      .prepare("INSERT OR REPLACE INTO storage_config (key, value) VALUES ('quota_bytes', ?)")
      .run(String(quotaBytes));
  }

  // ── Backup / restore ─────────────────

  async backup(sessionId: string, win: BrowserWindow): Promise<{ path: string }> {
    const session = requireAuth(sessionId);

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

    if (!this.restoreExecutor) {
      throw new AuthError('INTERNAL_ERROR', 'Restore is not configured');
    }

    await this.restoreExecutor({
      backupDir,
      backupDbPath,
      backupFilesDir,
      actorUserId: session.userId,
    });
  }

  /** Log a successful restore operation in the activity log. */
  logStorageRestoreActivity(userId: string, backupDirName: string): void {
    this.logActivity(userId, 'STORAGE_RESTORE', `Backup restored from ${backupDirName}`);
  }

  // ── Sessions (security dashboard) ────

  listActiveSessions(sessionId: string): SessionInfo[] {
    requireAuth(sessionId);

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
        `SELECT f.id, f.original_name, f.original_extension, f.stored_name, f.mime_type, f.size_bytes, f.sha256,
                f.shelf_id, s.name as shelf_name,
                f.is_encrypted, f.created_at, f.updated_at
         FROM files f
         JOIN shelves s ON f.shelf_id = s.id
         WHERE f.id = ?`,
      )
      .get(fileId) as FileRecord;
  }

  private normalizeSecurityThresholdSettings(
    input: Partial<SecurityThresholdSettings>,
  ): SecurityThresholdSettings {
    const storageWarn = Number.isFinite(input.storage_warn_percent)
      ? Number(input.storage_warn_percent)
      : DEFAULT_SECURITY_THRESHOLD_SETTINGS.storage_warn_percent;
    const storageDangerRaw = Number.isFinite(input.storage_danger_percent)
      ? Number(input.storage_danger_percent)
      : DEFAULT_SECURITY_THRESHOLD_SETTINGS.storage_danger_percent;
    const storageDanger = Math.max(storageWarn + 1, storageDangerRaw);

    const uploadWarn = Number.isFinite(input.upload_fail_warn_24h)
      ? Math.max(0, Math.trunc(Number(input.upload_fail_warn_24h)))
      : DEFAULT_SECURITY_THRESHOLD_SETTINGS.upload_fail_warn_24h;
    const uploadDangerRaw = Number.isFinite(input.upload_fail_danger_24h)
      ? Math.max(0, Math.trunc(Number(input.upload_fail_danger_24h)))
      : DEFAULT_SECURITY_THRESHOLD_SETTINGS.upload_fail_danger_24h;
    const uploadDanger = Math.max(uploadWarn, uploadDangerRaw);

    return {
      storage_warn_percent: Math.max(1, Math.min(99, storageWarn)),
      storage_danger_percent: Math.max(2, Math.min(100, storageDanger)),
      upload_fail_warn_24h: Math.min(1000, uploadWarn),
      upload_fail_danger_24h: Math.min(1000, uploadDanger),
    };
  }

  private ensureAnonymousUploadUser(): void {
    const existing = this.db
      .prepare('SELECT id FROM users WHERE id = ?')
      .get(ANONYMOUS_UPLOAD_USER_ID) as { id: string } | undefined;
    if (existing) return;

    this.db
      .prepare(
        `INSERT INTO users (id, username, password_hash, role, is_active, failed_attempts, locked_until)
         VALUES (?, ?, ?, 'staff', 0, 0, NULL)`,
      )
      .run(ANONYMOUS_UPLOAD_USER_ID, ANONYMOUS_UPLOAD_USERNAME, '!');
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

  private logActivity(userId: string | null, action: string, detail: string): void {
    this.db
      .prepare('INSERT INTO activity_log (id, user_id, action, detail) VALUES (?, ?, ?, ?)')
      .run(uuidv4(), userId, action, detail);
  }

  private deriveFileKey(password: string, salt: Buffer, iterations: number): Buffer {
    return crypto.pbkdf2Sync(
      Buffer.from(password, 'utf-8'),
      salt,
      iterations,
      PBKDF2_KEY_LEN,
      PBKDF2_DIGEST,
    );
  }

  private async decryptEncryptedPayloadToFile(
    fileId: string,
    srcPath: string,
    outputPath: string,
    decryptionPassword: string,
  ): Promise<void> {
    const metadata = this.db
      .prepare('SELECT salt, iv, auth_tag, iterations FROM encryption_keys WHERE file_id = ?')
      .get(fileId) as
      | { salt: string; iv: string; auth_tag: string; iterations: number }
      | undefined;

    if (!metadata || !metadata.salt || !metadata.iv || !metadata.auth_tag || !metadata.iterations) {
      throw new AuthError('ENCRYPTION_METADATA_MISSING', 'Encryption metadata is missing for this file');
    }

    const tempOutPath = makeTempPartPath(outputPath);
    try {
      const salt = Buffer.from(metadata.salt, 'base64');
      const iv = Buffer.from(metadata.iv, 'base64');
      const authTag = Buffer.from(metadata.auth_tag, 'base64');
      const key = this.deriveFileKey(decryptionPassword, salt, metadata.iterations);
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);

      await pipeline(fs.createReadStream(srcPath), decipher, fs.createWriteStream(tempOutPath));
      await fs.promises.rename(tempOutPath, outputPath);
    } catch (e) {
      if (fs.existsSync(tempOutPath)) {
        fs.rmSync(tempOutPath, { force: true });
      }
      const errorCode = extractErrorCode(e);
      const authTagErrorCodes = new Set(['ERR_OSSL_EVP_BAD_DECRYPT']);
      const message = e instanceof Error ? e.message.toLowerCase() : '';
      if (authTagErrorCodes.has(errorCode) || message.includes('auth') || message.includes('authenticate')) {
        throw new AuthError('DECRYPTION_FAILED_AUTH_TAG', 'File failed integrity check or is corrupted.');
      }
      throw new AuthError('DECRYPTION_FAILED_IO', 'Failed to decrypt and write file');
    }
  }

  private async createSecureTempViewTarget(fileRow: {
    id: string;
    original_name: string;
    original_extension?: string | null;
    stored_name: string;
    mime_type: string | null;
  }): Promise<{ tempDir: string; tempFilePath: string }> {
    const secureTempRoot = path.join(app.getPath('temp'), 'sccfs-secure-view');
    fs.mkdirSync(secureTempRoot, { recursive: true, mode: 0o700 });
    const tempDir = await fs.promises.mkdtemp(path.join(secureTempRoot, `${fileRow.id}-`));
    const tempFilePath = path.join(tempDir, this.resolveDownloadFileName(fileRow));
    return { tempDir, tempFilePath };
  }

  private scheduleSecureTempViewCleanup(viewId: string, tempDir: string): void {
    const existing = this.secureViewCleanupTimers.get(viewId);
    if (existing) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => {
      this.removeSecureTempView(viewId, tempDir);
    }, SECURE_TEMP_VIEW_TTL_MS);
    timer.unref();
    this.secureViewCleanupRetryCount.set(viewId, 0);
    this.secureViewCleanupTimers.set(viewId, timer);
  }

  private removeSecureTempView(viewId: string, fallbackTempDir?: string): void {
    const timer = this.secureViewCleanupTimers.get(viewId);
    if (timer) {
      clearTimeout(timer);
      this.secureViewCleanupTimers.delete(viewId);
    }
    const tempDir = this.secureViewTempById.get(viewId)?.tempDir ?? fallbackTempDir;
    if (!tempDir) return;
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
      this.secureViewCleanupRetryCount.delete(viewId);
      this.secureViewTempById.delete(viewId);
    } catch {
      const retryCount = (this.secureViewCleanupRetryCount.get(viewId) ?? 0) + 1;
      if (retryCount > MAX_SECURE_TEMP_CLEANUP_RETRIES) {
        this.secureViewCleanupRetryCount.delete(viewId);
        this.secureViewTempById.delete(viewId);
        return;
      }
      this.secureViewCleanupRetryCount.set(viewId, retryCount);
      const retry = setTimeout(() => {
        this.removeSecureTempView(viewId, tempDir);
      }, 15_000 * retryCount);
      retry.unref();
      this.secureViewCleanupTimers.set(viewId, retry);
    }
  }

  private async assertStoredUploadIntegrity(
    fileId: string,
    storedPath: string,
    expectedPlaintextSha256: string,
    encrypted: boolean,
    encryptionPassword?: string,
  ): Promise<void> {
    if (!fs.existsSync(storedPath)) {
      throw new AuthError('UPLOAD_INTEGRITY_MISSING_PAYLOAD', 'Stored payload was not found after upload');
    }

    if (encrypted) {
      if (!encryptionPassword) {
        throw new AuthError('UPLOAD_INTEGRITY_PASSWORD_REQUIRED', 'Encryption password required for integrity check');
      }
      await this.assertEncryptedPayloadIntegrity(fileId, storedPath, expectedPlaintextSha256, encryptionPassword);
      return;
    }
    await this.assertPlainPayloadIntegrity(storedPath, expectedPlaintextSha256);
  }

  private async assertPlainPayloadIntegrity(storedPath: string, expectedPlaintextSha256: string): Promise<void> {
    const storedSha256 = await computeSha256Stream(storedPath);
    if (storedSha256 !== expectedPlaintextSha256) {
      throw new AuthError('UPLOAD_INTEGRITY_HASH_MISMATCH', 'Plain upload integrity verification failed');
    }
  }

  private async assertEncryptedPayloadIntegrity(
    fileId: string,
    storedPath: string,
    expectedPlaintextSha256: string,
    encryptionPassword: string,
  ): Promise<void> {
    const metadata = this.db
      .prepare('SELECT salt, iv, auth_tag, iterations FROM encryption_keys WHERE file_id = ?')
      .get(fileId) as
      | { salt: string; iv: string; auth_tag: string; iterations: number }
      | undefined;

    if (!metadata || !metadata.salt || !metadata.iv || !metadata.auth_tag || !metadata.iterations) {
      throw new AuthError('UPLOAD_INTEGRITY_MISSING_METADATA', 'Encryption metadata is missing for uploaded file');
    }

    const hash = crypto.createHash('sha256');
    try {
      const salt = Buffer.from(metadata.salt, 'base64');
      const iv = Buffer.from(metadata.iv, 'base64');
      const authTag = Buffer.from(metadata.auth_tag, 'base64');
      const key = this.deriveFileKey(encryptionPassword, salt, metadata.iterations);
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);

      await pipeline(fs.createReadStream(storedPath), decipher, hash);
    } catch (e) {
      const errorCode = extractErrorCode(e);
      if (errorCode === 'ERR_OSSL_EVP_BAD_DECRYPT') {
        throw new AuthError('UPLOAD_INTEGRITY_AUTH_TAG', 'Encrypted file integrity check failed');
      }
      throw new AuthError('UPLOAD_INTEGRITY_DECRYPT', 'Encrypted file integrity verification failed');
    }

    const decryptedSha256 = hash.digest('hex');
    if (decryptedSha256 !== expectedPlaintextSha256) {
      throw new AuthError('UPLOAD_INTEGRITY_HASH_MISMATCH', 'Encrypted upload integrity verification failed');
    }
  }

  private rollbackUploadPersistence(params: {
    fileId: string;
    payloadId: string;
    storedName: string;
    reusedPayload: boolean;
    payloadWrittenToDisk: boolean;
  }): void {
    const payload = this.db
      .prepare('SELECT id, ref_count FROM file_payloads WHERE id = ?')
      .get(params.payloadId) as { id: string; ref_count: number } | undefined;

    const rollbackTx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM upload_history WHERE file_id = ?').run(params.fileId);
      this.db.prepare('DELETE FROM encryption_keys WHERE file_id = ?').run(params.fileId);
      this.db.prepare('DELETE FROM files WHERE id = ?').run(params.fileId);

      if (payload?.id) {
        if (!params.reusedPayload || payload.ref_count <= 1) {
          this.db.prepare('DELETE FROM file_payloads WHERE id = ?').run(payload.id);
        } else {
          this.db
            .prepare("UPDATE file_payloads SET ref_count = ref_count - 1, updated_at = datetime('now') WHERE id = ?")
            .run(payload.id);
        }
      }
    });
    rollbackTx();

    if (params.payloadWrittenToDisk) {
      const storedPath = path.join(getFilesDir(), params.storedName);
      if (fs.existsSync(storedPath)) {
        fs.rmSync(storedPath, { force: true });
      }
    }
  }

  private async removeOriginalFileSafely(filePath: string, confirmPermanentDelete: boolean): Promise<boolean> {
    if (!fs.existsSync(filePath)) return false;

    const permanentDeleteAllowed = this.db
      .prepare("SELECT value FROM app_config WHERE key = 'upload_allow_permanent_delete'")
      .get() as { value: string } | undefined;

    if (permanentDeleteAllowed?.value === '1' && confirmPermanentDelete) {
      fs.rmSync(filePath, { force: true });
      return true;
    }

    await shell.trashItem(filePath);
    return true;
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

  private resolveDownloadFileName(file: {
    original_name: string;
    original_extension?: string | null;
    stored_name: string;
    mime_type: string | null;
  }): string {
    const safeOriginalName = sanitizeFileName(file.original_name);
    const originalNameExtension = normalizeExtension(path.extname(safeOriginalName));
    if (originalNameExtension) {
      return safeOriginalName;
    }

    const extension =
      normalizeExtension(file.original_extension) ??
      normalizeExtension(path.extname(file.stored_name)) ??
      guessExtensionFromMime(file.mime_type);

    return extension ? `${safeOriginalName}${extension}` : safeOriginalName;
  }
}
