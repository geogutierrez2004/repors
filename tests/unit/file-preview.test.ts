import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import * as XLSX from 'xlsx';
import type { BrowserWindow } from 'electron';
import { runMigrations } from '../../src/main/database';
import { AuthService } from '../../src/main/services/auth.service';
import { DashboardService } from '../../src/main/services/dashboard.service';
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

describe('DashboardService.getFilePreview', () => {
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

    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sccfs-preview-'));
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
    shelfId = (db.prepare('SELECT id FROM shelves LIMIT 1').get() as { id: string }).id;
  });

  afterEach(() => {
    db.close();
    delete process.env['SCCFS_DATA_DIR'];
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('converts XLSX into HTML preview', async () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([['Name', 'Value'], ['A', 1]]);
    XLSX.utils.book_append_sheet(workbook, sheet, 'Sheet1');
    const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    const fileId = uuidv4();
    const storedName = `${uuidv4()}.xlsx`;
    const filesDir = path.join(dataDir, 'files');
    fs.mkdirSync(filesDir, { recursive: true });
    fs.writeFileSync(path.join(filesDir, storedName), bytes);

    db.prepare(
      `INSERT INTO files
      (id, original_name, original_extension, stored_name, mime_type, size_bytes, sha256, shelf_id, uploaded_by, is_encrypted)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    ).run(
      fileId,
      'sheet.xlsx',
      '.xlsx',
      storedName,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      bytes.length,
      crypto.createHash('sha256').update(bytes).digest('hex'),
      shelfId,
      userId,
    );

    const preview = await dashboard.getFilePreview(sessionId, fileId);
    expect(preview.classification.category).toBe('convertible');
    expect(preview.mimeType).toBe('text/html');
    expect(preview.note).toContain('Converted for preview');
    expect(Buffer.from(preview.fileContent, 'base64').toString('utf-8')).toContain('<table');
  });

  it('returns unsupported fallback metadata', async () => {
    const bytes = Buffer.from('zip-data');
    const fileId = uuidv4();
    const storedName = `${uuidv4()}.zip`;
    const filesDir = path.join(dataDir, 'files');
    fs.mkdirSync(filesDir, { recursive: true });
    fs.writeFileSync(path.join(filesDir, storedName), bytes);

    db.prepare(
      `INSERT INTO files
      (id, original_name, original_extension, stored_name, mime_type, size_bytes, sha256, shelf_id, uploaded_by, is_encrypted)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    ).run(
      fileId,
      'archive.zip',
      '.zip',
      storedName,
      'application/zip',
      bytes.length,
      crypto.createHash('sha256').update(bytes).digest('hex'),
      shelfId,
      userId,
    );

    const preview = await dashboard.getFilePreview(sessionId, fileId);
    expect(preview.classification.category).toBe('unsupported');
    expect(preview.fileContent).toBe('');
  });

  it('requires decryption password for encrypted preview', async () => {
    const uploadPath = path.join(dataDir, 'enc.bin');
    fs.writeFileSync(uploadPath, crypto.randomBytes(128));
    showOpenDialogMock.mockResolvedValue({ canceled: false, filePaths: [uploadPath] });

    const uploaded = await dashboard.uploadFile(
      sessionId,
      shelfId,
      true,
      'StrongPassword!123',
      'keep_original',
      false,
      {} as BrowserWindow,
    );
    const fileId = uploaded.files[0]?.file?.id as string;
    await expect(dashboard.getFilePreview(sessionId, fileId)).rejects.toMatchObject({
      code: 'DECRYPTION_PASSWORD_REQUIRED',
    });
  });
});
