import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import type { BrowserWindow } from 'electron';
import { runMigrations } from '../../src/main/database';
import { DashboardService } from '../../src/main/services/dashboard.service';
import { AuthService } from '../../src/main/services/auth.service';
import { clearAllSessions } from '../../src/main/services/session.service';

const { showOpenDialogMock, showSaveDialogMock } = vi.hoisted(() => ({
  showOpenDialogMock: vi.fn(),
  showSaveDialogMock: vi.fn(),
}));

vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: showOpenDialogMock,
    showSaveDialog: showSaveDialogMock,
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

    const uploaded = await dashboard.uploadFile(sessionId, shelfId, false, {} as BrowserWindow);

    expect(uploaded.original_extension).toBe('.txt');

    const row = db
      .prepare('SELECT original_name, original_extension FROM files WHERE id = ?')
      .get(uploaded.id) as { original_name: string; original_extension: string | null };
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
});
