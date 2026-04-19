/**
 * BrowserWindow factory with strict security configuration (spec §2.4).
 */
import { BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';

let droppedFilesStore: string[] = [];

export function createMainWindow(): BrowserWindow {
  const isDev = process.env['NODE_ENV'] === 'development';

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    title: 'St. Clare College Filing System',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Keep sandbox off for now so preload can load shared modules and expose window.sccfs.
      sandbox: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  // Hide native menu
  win.removeMenu();

  // Register IPC handlers for dropped files
  ipcMain.handle('store-dropped-files', (_event, filePaths: string[]) => {
    droppedFilesStore = filePaths;
    return { ok: true };
  });

  ipcMain.handle('get-dropped-files', () => {
    const files = droppedFilesStore;
    droppedFilesStore = []; // Clear after retrieval
    return files;
  });

  // In development, load from dev server; in production, load bundled HTML
  if (isDev) {
    void win.loadURL('http://localhost:3000');
    win.webContents.openDevTools();
  } else {
    void win.loadFile(path.join(__dirname, '..', '..', 'renderer', 'renderer', 'index.html'));
  }

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    const allowed = isDev ? url.startsWith('http://localhost:3000') : url.startsWith('file://');
    if (!allowed) {
      event.preventDefault();
    }
  });

  // Show window after content is loaded
  win.once('ready-to-show', () => {
    win.show();
    win.maximize();
  });

  return win;
}
