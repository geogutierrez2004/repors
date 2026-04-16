import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import type { BrowserWindow } from 'electron';
import { runMigrations } from '../../src/main/database';
import { DashboardService } from '../../src/main/services/dashboard.service';
import { AuthService } from '../../src/main/services/auth.service';
import { clearAllSessions } from '../../src/main/services/session.service';

const { showOpenDialogMock, showSaveDialogMock, trashItemMock } = vi.hoisted(() => ({
  showOpenDialogMock: vi.fn(),
  showSaveDialogMock: vi.fn(),
  trashItemMock: vi.fn(),
}));

vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: showOpenDialogMock,
    showSaveDialog: showSaveDialogMock,
  },
  shell: {
    trashItem: trashItemMock,
  },
  BrowserWindow: class BrowserWindow {},
  app: {
    getPath: vi.fn(() => os.tmpdir()),
  },
}));

describe('DashboardService file extension handling', () => {
  let db: Database.Database;
  let auth: AuthService;
  let dashboard: DashboardService;
  let sessionId: string;
  let userId: string;
  let shelfId: string;
  let dataDir: string;

  beforeEach(async () => {
    clearAllSessions();
    showOpenDialogMock.mockReset();
    showSaveDialogMock.mockReset();
    trashItemMock.mockReset();
    trashItemMock.mockResolvedValue(undefined);

    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sccfs-ext-'));
    process.env['SCCFS_DATA_DIR'] = dataDir;

    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);

    auth = new AuthService(db);
    await auth.seedDefaultAdmin('fs_adm1', 'admin123');
    const login = await auth.login('fs_adm1', 'admin123');
    sessionId = login.sessionId;
    userId = login.user.id;

    dashboard = new DashboardService(db);
    dashboard.seedSystemShelves();
    const shelf = db.prepare('SELECT id FROM shelves LIMIT 1').get() as { id: string };
    shelfId = shelf.id;
  });

  afterEach(() => {
    db.close();
    delete process.env['SCCFS_DATA_DIR'];
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('upload of a .txt file preserves .txt extension metadata', async () => {
    const uploadPath = path.join(dataDir, 'incoming.txt');
    fs.writeFileSync(uploadPath, 'hello world', 'utf-8');

    showOpenDialogMock.mockResolvedValue({ canceled: false, filePaths: [uploadPath] });

    const uploaded = await dashboard.uploadFile(
      sessionId,
      shelfId,
      false,
      'keep_original',
      false,
      {} as BrowserWindow,
    );
    const uploadedFile = uploaded.files[0]?.file;
    expect(uploaded.files[0]?.success).toBe(true);
    expect(uploadedFile).toBeTruthy();

    expect(uploadedFile?.original_extension).toBe('.txt');

    const row = db
      .prepare('SELECT original_name, original_extension FROM files WHERE id = ?')
      .get(uploadedFile?.id) as { original_name: string; original_extension: string | null };
    expect(row.original_name).toBe('incoming.txt');
    expect(row.original_extension).toBe('.txt');
  });

  it('download uses preserved extension metadata for restored rows', async () => {
    const fileId = uuidv4();
    const storedName = 'restored-blob';
    const fileBytes = Buffer.from('restored file');
    const filesDir = path.join(dataDir, 'files');
    fs.mkdirSync(filesDir, { recursive: true });
    fs.writeFileSync(path.join(filesDir, storedName), fileBytes);

    db.prepare(
      `INSERT INTO files
       (id, original_name, original_extension, stored_name, mime_type, size_bytes, sha256, shelf_id, uploaded_by, is_encrypted)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    ).run(fileId, 'restored-report', '.txt', storedName, 'text/plain', fileBytes.length, 'abc123', shelfId, userId);

    const downloadPath = path.join(dataDir, 'downloaded-restored.txt');
    showSaveDialogMock.mockImplementation(async (_win: unknown, opts: { defaultPath: string }) => {
      expect(opts.defaultPath).toBe('restored-report.txt');
      return { canceled: false, filePath: downloadPath };
    });

    await dashboard.downloadFile(sessionId, fileId, {} as BrowserWindow);

    expect(fs.readFileSync(downloadPath, 'utf-8')).toBe('restored file');
  });

  it('files without extensions get fallback extension when possible', async () => {
    const fileId = uuidv4();
    const storedName = 'blob-without-ext';
    const fileBytes = Buffer.from('fallback');
    const filesDir = path.join(dataDir, 'files');
    fs.mkdirSync(filesDir, { recursive: true });
    fs.writeFileSync(path.join(filesDir, storedName), fileBytes);

    db.prepare(
      `INSERT INTO files
       (id, original_name, original_extension, stored_name, mime_type, size_bytes, sha256, shelf_id, uploaded_by, is_encrypted)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    ).run(fileId, 'fallback-name', null, storedName, 'text/plain', fileBytes.length, 'def456', shelfId, userId);

    const downloadPath = path.join(dataDir, 'downloaded-fallback.txt');
    showSaveDialogMock.mockImplementation(async (_win: unknown, opts: { defaultPath: string }) => {
      expect(opts.defaultPath).toBe('fallback-name.txt');
      return { canceled: false, filePath: downloadPath };
    });

    await dashboard.downloadFile(sessionId, fileId, {} as BrowserWindow);

    expect(fs.readFileSync(downloadPath, 'utf-8')).toBe('fallback');
  });

  it('existing filenames with valid extensions take precedence over stored extension metadata', async () => {
    const fileId = uuidv4();
    const storedName = 'stored-file.txt';
    const fileBytes = Buffer.from('keep extension');
    const filesDir = path.join(dataDir, 'files');
    fs.mkdirSync(filesDir, { recursive: true });
    fs.writeFileSync(path.join(filesDir, storedName), fileBytes);

    db.prepare(
      `INSERT INTO files
       (id, original_name, original_extension, stored_name, mime_type, size_bytes, sha256, shelf_id, uploaded_by, is_encrypted)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    ).run(fileId, 'already.pdf', '.txt', storedName, 'text/plain', fileBytes.length, 'ghi789', shelfId, userId);

    const downloadPath = path.join(dataDir, 'downloaded-existing.pdf');
    showSaveDialogMock.mockImplementation(async (_win: unknown, opts: { defaultPath: string }) => {
      expect(opts.defaultPath).toBe('already.pdf');
      return { canceled: false, filePath: downloadPath };
    });

    await dashboard.downloadFile(sessionId, fileId, {} as BrowserWindow);

    expect(fs.readFileSync(downloadPath, 'utf-8')).toBe('keep extension');
  });

  it('encrypted upload then download returns original bytes', async () => {
    const uploadPath = path.join(dataDir, 'secure.bin');
    const originalBytes = crypto.randomBytes(2048);
    fs.writeFileSync(uploadPath, originalBytes);

    showOpenDialogMock.mockResolvedValue({ canceled: false, filePaths: [uploadPath] });

    const uploadRes = await dashboard.uploadFile(
      sessionId,
      shelfId,
      true,
      'keep_original',
      false,
      {} as BrowserWindow,
    );
    expect(uploadRes.files[0]?.success).toBe(true);
    const fileId = uploadRes.files[0]?.file?.id;
    expect(fileId).toBeTruthy();

    const fileRow = db
      .prepare('SELECT is_encrypted FROM files WHERE id = ?')
      .get(fileId) as { is_encrypted: number };
    expect(fileRow.is_encrypted).toBe(1);

    const keyRow = db
      .prepare('SELECT salt, iv, auth_tag, iterations FROM encryption_keys WHERE file_id = ?')
      .get(fileId) as { salt: string; iv: string; auth_tag: string; iterations: number } | undefined;
    expect(keyRow).toBeTruthy();
    expect(keyRow?.iterations).toBeGreaterThanOrEqual(600_000);

    const downloadPath = path.join(dataDir, 'secure-downloaded.bin');
    showSaveDialogMock.mockResolvedValue({ canceled: false, filePath: downloadPath });

    await dashboard.downloadFile(sessionId, fileId as string, {} as BrowserWindow);
    expect(fs.readFileSync(downloadPath)).toEqual(originalBytes);
  });

  it('encrypted upload stores ciphertext only in system storage', async () => {
    const uploadPath = path.join(dataDir, 'ciphertext-check.txt');
    const plaintext = Buffer.from('TOP-SECRET-DATA::'.repeat(128), 'utf-8');
    fs.writeFileSync(uploadPath, plaintext);
    showOpenDialogMock.mockResolvedValue({ canceled: false, filePaths: [uploadPath] });

    const uploadRes = await dashboard.uploadFile(
      sessionId,
      shelfId,
      true,
      'keep_original',
      false,
      {} as BrowserWindow,
    );

    const file = uploadRes.files[0]?.file;
    expect(uploadRes.files[0]?.success).toBe(true);
    expect(file).toBeTruthy();

    const storedPath = path.join(dataDir, 'files', file!.stored_name);
    const storedBytes = fs.readFileSync(storedPath);
    expect(storedBytes.equals(plaintext)).toBe(false);
    expect(storedBytes.includes(Buffer.from('TOP-SECRET-DATA::', 'utf-8'))).toBe(false);
  });

  it('tampered encrypted file fails auth-tag validation and leaves no plaintext output', async () => {
    const uploadPath = path.join(dataDir, 'tamper.bin');
    fs.writeFileSync(uploadPath, crypto.randomBytes(1024));
    showOpenDialogMock.mockResolvedValue({ canceled: false, filePaths: [uploadPath] });

    const uploadRes = await dashboard.uploadFile(
      sessionId,
      shelfId,
      true,
      'keep_original',
      false,
      {} as BrowserWindow,
    );
    const file = uploadRes.files[0]?.file;
    expect(file).toBeTruthy();

    const storedPath = path.join(dataDir, 'files', file!.stored_name);
    const encryptedBytes = fs.readFileSync(storedPath);
    encryptedBytes[0] = encryptedBytes[0] ^ 0xff;
    fs.writeFileSync(storedPath, encryptedBytes);

    const downloadPath = path.join(dataDir, 'tamper-out.bin');
    showSaveDialogMock.mockResolvedValue({ canceled: false, filePath: downloadPath });

    await expect(dashboard.downloadFile(sessionId, file!.id, {} as BrowserWindow)).rejects.toMatchObject({
      code: 'DECRYPTION_FAILED_AUTH_TAG',
    });
    expect(fs.existsSync(downloadPath)).toBe(false);
    const tempParts = fs.readdirSync(dataDir).filter((name) => name.includes('tamper-out.bin') && name.endsWith('.part'));
    expect(tempParts).toHaveLength(0);
  });

  it('missing encryption metadata fails cleanly for encrypted file', async () => {
    const uploadPath = path.join(dataDir, 'missing-meta.bin');
    fs.writeFileSync(uploadPath, crypto.randomBytes(256));
    showOpenDialogMock.mockResolvedValue({ canceled: false, filePaths: [uploadPath] });

    const uploadRes = await dashboard.uploadFile(
      sessionId,
      shelfId,
      true,
      'keep_original',
      false,
      {} as BrowserWindow,
    );
    const fileId = uploadRes.files[0]?.file?.id as string;
    db.prepare('DELETE FROM encryption_keys WHERE file_id = ?').run(fileId);

    const downloadPath = path.join(dataDir, 'missing-meta-out.bin');
    showSaveDialogMock.mockResolvedValue({ canceled: false, filePath: downloadPath });

    await expect(dashboard.downloadFile(sessionId, fileId, {} as BrowserWindow)).rejects.toMatchObject({
      code: 'ENCRYPTION_METADATA_MISSING',
    });
    expect(fs.existsSync(downloadPath)).toBe(false);
  });

  it('unencrypted upload and download flow remains unchanged', async () => {
    const uploadPath = path.join(dataDir, 'plain-flow.txt');
    const originalText = 'plain file content';
    fs.writeFileSync(uploadPath, originalText, 'utf-8');
    showOpenDialogMock.mockResolvedValue({ canceled: false, filePaths: [uploadPath] });

    const uploadRes = await dashboard.uploadFile(
      sessionId,
      shelfId,
      false,
      'keep_original',
      false,
      {} as BrowserWindow,
    );
    const file = uploadRes.files[0]?.file;
    expect(uploadRes.files[0]?.success).toBe(true);
    const fileRow = db.prepare('SELECT is_encrypted FROM files WHERE id = ?').get(file?.id) as { is_encrypted: number };
    expect(fileRow.is_encrypted).toBe(0);

    const keyRow = db.prepare('SELECT file_id FROM encryption_keys WHERE file_id = ?').get(file?.id);
    expect(keyRow).toBeUndefined();

    const downloadPath = path.join(dataDir, 'plain-flow-out.txt');
    showSaveDialogMock.mockResolvedValue({ canceled: false, filePath: downloadPath });
    await dashboard.downloadFile(sessionId, file!.id, {} as BrowserWindow);

    expect(fs.readFileSync(downloadPath, 'utf-8')).toBe(originalText);
  });

  it('move_to_system removes source only after full upload success', async () => {
    const uploadPath = path.join(dataDir, 'move-success.txt');
    fs.writeFileSync(uploadPath, 'move me', 'utf-8');
    showOpenDialogMock.mockResolvedValue({ canceled: false, filePaths: [uploadPath] });
    trashItemMock.mockImplementation(async (targetPath: string) => {
      fs.rmSync(targetPath, { force: true });
    });

    const uploadRes = await dashboard.uploadFile(
      sessionId,
      shelfId,
      true,
      'move_to_system',
      false,
      {} as BrowserWindow,
    );

    expect(uploadRes.files[0]?.success).toBe(true);
    expect(uploadRes.files[0]?.removed_original).toBe(true);
    expect(trashItemMock).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(uploadPath)).toBe(false);
  });

  it('move_to_system does not remove original when upload fails', async () => {
    const uploadPath = path.join(dataDir, 'move-fail.txt');
    fs.writeFileSync(uploadPath, 'do not remove', 'utf-8');
    showOpenDialogMock.mockResolvedValue({ canceled: false, filePaths: [uploadPath] });
    db.prepare("INSERT OR REPLACE INTO storage_config (key, value) VALUES ('quota_bytes', '1')").run();

    const uploadRes = await dashboard.uploadFile(
      sessionId,
      shelfId,
      true,
      'move_to_system',
      false,
      {} as BrowserWindow,
    );

    expect(uploadRes.files[0]?.success).toBe(false);
    expect(uploadRes.files[0]?.removed_original).toBe(false);
    expect(trashItemMock).not.toHaveBeenCalled();
    expect(fs.existsSync(uploadPath)).toBe(true);
  });
});
