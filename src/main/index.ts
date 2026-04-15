/**
 * Electron main process entry point.
 *
 * Responsibilities (spec §2.1):
 * - Own SQLite access, filesystem I/O, encryption/decryption, and IPC handlers
 * - Verify sessions and role permissions on every privileged operation
 * - Validate IPC payloads (zod) and return normalized error envelopes
 */
import { app, BrowserWindow } from 'electron';
import { getDatabase } from './database/connection';
import { runMigrations } from './database';
import { AuthService } from './services/auth.service';
import { DashboardService } from './services/dashboard.service';
import { registerAllHandlers } from './ipc/registry';
import { createMainWindow } from './window';

let mainWindow: BrowserWindow | null = null;

async function bootstrap(): Promise<void> {
  // Initialize database
  const db = getDatabase();
  runMigrations(db);

  // Initialize services
  const authService = new AuthService(db);
  const dashboardService = new DashboardService(db);

  // Seed default admin if no users exist
  await authService.seedDefaultAdmin('admin', 'Admin@1234');

  // Seed system shelves and default storage quota
  dashboardService.seedSystemShelves();

  // Register all IPC handlers
  registerAllHandlers({ authService, dashboardService });

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

