import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { performHotSwapRestore } from '../../src/main/restore/hot-swap';
import { AuthError } from '../../src/main/services/auth.service';
import type { MainServices } from '../../src/main/services/container';

function writeText(filePath: string, contents: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, 'utf-8');
}

function readText(filePath: string): string {
  return fs.readFileSync(filePath, 'utf-8');
}

describe('performHotSwapRestore', () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  function setupFs() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sccfs-restore-'));
    tempRoots.push(root);

    const currentDbPath = path.join(root, 'data', 'sccfs.db');
    const currentFilesDir = path.join(root, 'files');
    const backupDbPath = path.join(root, 'backup', 'sccfs.db');
    const backupFilesDir = path.join(root, 'backup', 'files');

    writeText(currentDbPath, 'live-db');
    writeText(path.join(currentFilesDir, 'live.txt'), 'live-file');
    writeText(backupDbPath, 'restored-db');
    writeText(path.join(backupFilesDir, 'restored.txt'), 'restored-file');

    return {
      currentDbPath,
      currentFilesDir,
      backupDbPath,
      backupFilesDir,
    };
  }

  it('restores successfully without restart and activates new services', async () => {
    const fsCtx = setupFs();
    const activated: MainServices[] = [];
    const invalidateSessions = vi.fn();
    const notifyRestored = vi.fn();
    const migrations = vi.fn();
    const logRestoreActivity = vi.fn();

    await performHotSwapRestore(
      {
        backupDbPath: fsCtx.backupDbPath,
        backupFilesDir: fsCtx.backupFilesDir,
      },
      {
        getCurrentDbPath: () => fsCtx.currentDbPath,
        getCurrentFilesDir: () => fsCtx.currentFilesDir,
        closeDatabase: vi.fn(),
        openDatabase: (dbPath: string) =>
          ({ label: readText(dbPath) } as unknown as Database.Database),
        runMigrations: (db: Database.Database) => migrations(db),
        createServices: (db: Database.Database) =>
          ({ authService: { db }, dashboardService: { db } } as unknown as MainServices),
        activateServices: (services: MainServices) => activated.push(services),
        seedServices: vi.fn(),
        invalidateSessions,
        notifyRestored,
        logRestoreActivity,
      },
    );

    expect(readText(fsCtx.currentDbPath)).toBe('restored-db');
    expect(readText(path.join(fsCtx.currentFilesDir, 'restored.txt'))).toBe('restored-file');
    expect(fs.existsSync(path.join(fsCtx.currentFilesDir, 'live.txt'))).toBe(false);
    expect(activated).toHaveLength(1);
    expect((activated[0].authService as unknown as { db: { label: string } }).db.label).toBe('restored-db');
    expect(migrations).toHaveBeenCalledTimes(1);
    expect(invalidateSessions).toHaveBeenCalledTimes(1);
    expect(notifyRestored).toHaveBeenCalledTimes(1);
    expect(logRestoreActivity).toHaveBeenCalledTimes(1);
  });

  it('does not mix old and new service activations on successful restore', async () => {
    const fsCtx = setupFs();
    const activated: MainServices[] = [];

    await performHotSwapRestore(
      {
        backupDbPath: fsCtx.backupDbPath,
        backupFilesDir: fsCtx.backupFilesDir,
      },
      {
        getCurrentDbPath: () => fsCtx.currentDbPath,
        getCurrentFilesDir: () => fsCtx.currentFilesDir,
        closeDatabase: vi.fn(),
        openDatabase: (dbPath: string) =>
          ({ label: readText(dbPath) } as unknown as Database.Database),
        runMigrations: vi.fn(),
        createServices: (db: Database.Database) =>
          ({ authService: { db }, dashboardService: { db } } as unknown as MainServices),
        activateServices: (services: MainServices) => activated.push(services),
        seedServices: vi.fn(),
        invalidateSessions: vi.fn(),
        notifyRestored: vi.fn(),
        logRestoreActivity: vi.fn(),
      },
    );

    expect(activated).toHaveLength(1);
    expect((activated[0].dashboardService as unknown as { db: { label: string } }).db.label).toBe('restored-db');
  });

  it('rolls back files and db when restore activation fails', async () => {
    const fsCtx = setupFs();
    const activated: MainServices[] = [];
    let openCount = 0;

    await expect(
      performHotSwapRestore(
        {
          backupDbPath: fsCtx.backupDbPath,
          backupFilesDir: fsCtx.backupFilesDir,
        },
        {
          getCurrentDbPath: () => fsCtx.currentDbPath,
          getCurrentFilesDir: () => fsCtx.currentFilesDir,
          closeDatabase: vi.fn(),
          openDatabase: (dbPath: string) => {
            openCount += 1;
            if (openCount === 1) {
              throw new Error('open failed after restore copy');
            }
            return { label: readText(dbPath) } as unknown as Database.Database;
          },
          runMigrations: vi.fn(),
          createServices: (db: Database.Database) =>
            ({ authService: { db }, dashboardService: { db } } as unknown as MainServices),
          activateServices: (services: MainServices) => activated.push(services),
          seedServices: vi.fn(),
          invalidateSessions: vi.fn(),
          notifyRestored: vi.fn(),
          logRestoreActivity: vi.fn(),
        },
      ),
    ).rejects.toMatchObject({ code: 'RESTORE_FAILED' });

    expect(readText(fsCtx.currentDbPath)).toBe('live-db');
    expect(readText(path.join(fsCtx.currentFilesDir, 'live.txt'))).toBe('live-file');
    expect(fs.existsSync(path.join(fsCtx.currentFilesDir, 'restored.txt'))).toBe(false);
    expect(activated).toHaveLength(1);
    expect((activated[0].authService as unknown as { db: { label: string } }).db.label).toBe('live-db');
  });

  it('returns deterministic restore error envelope', async () => {
    const fsCtx = setupFs();

    await expect(
      performHotSwapRestore(
        {
          backupDbPath: fsCtx.backupDbPath,
          backupFilesDir: fsCtx.backupFilesDir,
        },
        {
          getCurrentDbPath: () => fsCtx.currentDbPath,
          getCurrentFilesDir: () => fsCtx.currentFilesDir,
          closeDatabase: vi.fn(),
          openDatabase: () => {
            throw new Error('boom');
          },
          runMigrations: vi.fn(),
          createServices: vi.fn(),
          activateServices: vi.fn(),
          seedServices: vi.fn(),
          invalidateSessions: vi.fn(),
          notifyRestored: vi.fn(),
          logRestoreActivity: vi.fn(),
        },
      ),
    ).rejects.toSatisfy((error: unknown) => {
      return error instanceof AuthError
        && error.code === 'RESTORE_FAILED'
        && /Failed to restore backup/.test(error.message);
    });
  });

  it('invalidates sessions only after successful restore', async () => {
    const fsCtx = setupFs();
    const invalidateSessions = vi.fn();

    await performHotSwapRestore(
      {
        backupDbPath: fsCtx.backupDbPath,
        backupFilesDir: fsCtx.backupFilesDir,
      },
      {
        getCurrentDbPath: () => fsCtx.currentDbPath,
        getCurrentFilesDir: () => fsCtx.currentFilesDir,
        closeDatabase: vi.fn(),
        openDatabase: (dbPath: string) =>
          ({ label: readText(dbPath) } as unknown as Database.Database),
        runMigrations: vi.fn(),
        createServices: (db: Database.Database) =>
          ({ authService: { db }, dashboardService: { db } } as unknown as MainServices),
        activateServices: vi.fn(),
        seedServices: vi.fn(),
        invalidateSessions,
        notifyRestored: vi.fn(),
        logRestoreActivity: vi.fn(),
      },
    );

    expect(invalidateSessions).toHaveBeenCalledTimes(1);
  });
});
