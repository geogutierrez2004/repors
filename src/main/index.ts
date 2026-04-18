/**
 * Electron main process entry point.
 *
 * Responsibilities (spec §2.1):
 * - Own SQLite access, filesystem I/O, encryption/decryption, and IPC handlers
 * - Verify authenticated sessions on every privileged operation
 * - Validate IPC payloads (zod) and return normalized error envelopes
 */
import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { getDatabase } from './database/connection';
import { runMigrations } from './database';
import { closeDatabase, getDatabasePath } from './database/connection';
import { createServices, type MainServices } from './services/container';
import { AuthError } from './services/auth.service';
import { registerHandlers, type IpcInvokeGuard } from './ipc/registry';
import { createMainWindow } from './window';
import { performHotSwapRestore } from './restore/hot-swap';
import { clearAllSessions } from './services/session.service';
import { IPC_CHANNELS } from '../shared/ipc-channels';
import type { IpcResponse } from '../shared/types';

let mainWindow: BrowserWindow | null = null;
let services: MainServices | null = null;
let restoreInProgress = false;
const DEFAULT_ADMIN_USERNAME = 'fs_adm1';
const DEFAULT_ADMIN_PASSWORD = 'M0n$p33t101';

function getFilesDir(): string {
  const appData =
    process.env['SCCFS_DATA_DIR'] ||
    (typeof app !== 'undefined' ? app.getPath('userData') : path.join(process.cwd(), '.sccfs-data'));
  const filesDir = path.join(appData, 'files');
  fs.mkdirSync(filesDir, { recursive: true });
  return filesDir;
}

function createRestoreGuard(): IpcInvokeGuard {
  return async <T>(invoke: () => Promise<IpcResponse<T>>) => {
    if (restoreInProgress) {
      return {
        ok: false,
        error: {
          code: 'RESTORE_IN_PROGRESS',
          message: 'Restore is in progress. Please retry in a moment.',
        },
      };
    }
    return invoke();
  };
}

async function bootstrap(): Promise<void> {
  // Initialize database
  const db = getDatabase();
  runMigrations(db);

  const withRestoreGuard = createRestoreGuard();

  const restoreExecutor = async (request: {
    backupDir: string;
    backupDbPath: string;
    backupFilesDir: string;
    actorUserId: string;
  }) => {
    if (restoreInProgress) {
      throw new AuthError('RESTORE_IN_PROGRESS', 'Restore is already in progress');
    }
    restoreInProgress = true;

    try {
      await performHotSwapRestore(
        {
          backupDbPath: request.backupDbPath,
          backupFilesDir: request.backupFilesDir,
        },
        {
          getCurrentDbPath: () => getDatabasePath(),
          getCurrentFilesDir: () => getFilesDir(),
          closeDatabase: () => closeDatabase(),
          openDatabase: (dbPath: string) => getDatabase(dbPath),
          runMigrations: (nextDb) => runMigrations(nextDb),
          createServices: (nextDb) => createServices(nextDb, { restoreExecutor }),
          seedServices: async (nextServices) => {
            await nextServices.authService.seedDefaultAdmin(DEFAULT_ADMIN_USERNAME, DEFAULT_ADMIN_PASSWORD);
            nextServices.dashboardService.seedSystemShelves();
          },
          logRestoreActivity: (nextServices) => {
            nextServices.dashboardService.logStorageRestoreActivity(
              request.actorUserId,
              path.basename(request.backupDir),
            );
          },
          activateServices: (nextServices) => {
            services = nextServices;
            registerHandlers(nextServices, { guard: withRestoreGuard });
          },
          invalidateSessions: () => clearAllSessions(),
          notifyRestored: () => {
            mainWindow?.webContents.send(IPC_CHANNELS.APP_RESTORED, { sessionInvalidated: true });
          },
        },
      );
    } finally {
      restoreInProgress = false;
    }
  };

  services = createServices(db, { restoreExecutor });

  // Seed default admin if no users exist
  await services.authService.seedDefaultAdmin(DEFAULT_ADMIN_USERNAME, DEFAULT_ADMIN_PASSWORD);

  // Seed system shelves and default storage quota
  services.dashboardService.seedSystemShelves();

  // Register all IPC handlers
  registerHandlers(services, { guard: withRestoreGuard });

  // Create main window
  mainWindow = createMainWindow();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function handleStartupError(error: unknown): void {
  console.error('SCCFS startup failed:', error);
}

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(bootstrap).catch(handleStartupError);
}

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  services?.dashboardService.cleanupSecureTempViews();
});
