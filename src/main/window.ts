/**
 * BrowserWindow factory with strict security configuration (spec §2.4).
 */
import { BrowserWindow } from 'electron';
import path from 'node:path';

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
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

  // In development, load from dev server; in production, load bundled HTML
  const isDev = process.env['NODE_ENV'] === 'development';
  if (isDev) {
    void win.loadURL('http://localhost:3000');
    win.webContents.openDevTools();
  } else {
    void win.loadFile(path.join(__dirname, '..', '..', 'renderer', 'renderer', 'index.html'));
  }

  return win;
}
