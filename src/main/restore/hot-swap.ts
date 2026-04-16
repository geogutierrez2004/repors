import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { AuthError } from '../services/auth.service';
import type { MainServices } from '../services/container';

export interface RestoreRequest {
  backupDbPath: string;
  backupFilesDir: string;
}

export interface HotSwapRestoreDependencies {
  getCurrentDbPath: () => string | null;
  getCurrentFilesDir: () => string;
  closeDatabase: () => void;
  openDatabase: (dbPath: string) => Database.Database;
  runMigrations: (db: Database.Database) => void;
  createServices: (db: Database.Database) => MainServices;
  activateServices: (services: MainServices) => void;
  seedServices: (services: MainServices) => Promise<void> | void;
  invalidateSessions: () => void;
  notifyRestored: () => void;
  logRestoreActivity: (services: MainServices) => void;
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
  } catch (error) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    if (hadTarget && fs.existsSync(previousDir) && !fs.existsSync(targetDir)) {
      fs.renameSync(previousDir, targetDir);
    }
    throw error;
  }
}

function normalizeError(error: unknown): AuthError {
  if (error instanceof AuthError) return error;
  const message = error instanceof Error ? error.message : 'Unknown restore error';
  return new AuthError('RESTORE_FAILED', `Failed to restore backup: ${message}`);
}

export async function performHotSwapRestore(
  request: RestoreRequest,
  deps: HotSwapRestoreDependencies,
): Promise<void> {
  const currentDbPath = deps.getCurrentDbPath();
  if (!currentDbPath) {
    throw new AuthError('INTERNAL_ERROR', 'Cannot determine database path');
  }

  const currentFilesDir = deps.getCurrentFilesDir();
  const safetyRoot = fs.mkdtempSync(path.join(path.dirname(currentDbPath), 'sccfs-pre-restore-'));
  const safetyBackupDb = path.join(safetyRoot, 'sccfs.db');
  const safetyBackupFiles = path.join(safetyRoot, 'files');

  let appliedRestore = false;

  try {
    deps.closeDatabase();
    fs.copyFileSync(currentDbPath, safetyBackupDb);
    fs.cpSync(currentFilesDir, safetyBackupFiles, { recursive: true });

    fs.copyFileSync(request.backupDbPath, currentDbPath);
    replaceDirectory(currentFilesDir, request.backupFilesDir);
    appliedRestore = true;

    const nextDb = deps.openDatabase(currentDbPath);
    deps.runMigrations(nextDb);
    const nextServices = deps.createServices(nextDb);
    await deps.seedServices(nextServices);
    deps.logRestoreActivity(nextServices);
    deps.activateServices(nextServices);
    deps.invalidateSessions();
    deps.notifyRestored();
  } catch (error) {
    try {
      if (appliedRestore) {
        deps.closeDatabase();
      }
      if (fs.existsSync(safetyBackupDb)) {
        fs.copyFileSync(safetyBackupDb, currentDbPath);
      }
      if (fs.existsSync(safetyBackupFiles)) {
        replaceDirectory(currentFilesDir, safetyBackupFiles);
      }

      const rollbackDb = deps.openDatabase(currentDbPath);
      deps.runMigrations(rollbackDb);
      const rollbackServices = deps.createServices(rollbackDb);
      await deps.seedServices(rollbackServices);
      deps.activateServices(rollbackServices);
    } catch {
      // Best effort rollback; keep original restore error envelope.
    }

    throw normalizeError(error);
  } finally {
    fs.rmSync(safetyRoot, { recursive: true, force: true });
  }
}
