/**
 * IPC handler registry.
 *
 * Centralizes all handler registrations so the main process entry
 * point has a single call to set up all IPC communication.
 */
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import type { IpcResponse } from '../../shared/types';
import type { AuthService } from '../services/auth.service';
import type { DashboardService } from '../services/dashboard.service';
import { registerAuthHandlers } from './auth.handler';
import { registerDashboardHandlers } from './dashboard.handler';

export type IpcInvokeGuard = <T>(invoke: () => Promise<IpcResponse<T>>) => Promise<IpcResponse<T>>;

const HANDLER_CHANNELS: readonly string[] = [
  IPC_CHANNELS.AUTH_LOGIN,
  IPC_CHANNELS.AUTH_LOGOUT,
  IPC_CHANNELS.AUTH_VALIDATE_SESSION,
  IPC_CHANNELS.AUTH_CHANGE_PASSWORD,
  IPC_CHANNELS.AUTH_GET_CURRENT_USER,
  IPC_CHANNELS.USERS_LIST,
  IPC_CHANNELS.USERS_CREATE,
  IPC_CHANNELS.USERS_UPDATE,
  IPC_CHANNELS.USERS_DELETE,
  IPC_CHANNELS.USERS_RESET_PASSWORD,
  IPC_CHANNELS.USERS_UNLOCK,
  IPC_CHANNELS.DASHBOARD_STATS,
  IPC_CHANNELS.FILES_LIST,
  IPC_CHANNELS.FILES_UPLOAD,
  IPC_CHANNELS.FILES_DOWNLOAD,
  IPC_CHANNELS.FILES_DELETE,
  IPC_CHANNELS.FILES_MOVE,
  IPC_CHANNELS.SHELVES_LIST,
  IPC_CHANNELS.SHELVES_CREATE,
  IPC_CHANNELS.SHELVES_DELETE,
  IPC_CHANNELS.SHELVES_RENAME,
  IPC_CHANNELS.ACTIVITY_LIST,
  IPC_CHANNELS.STORAGE_STATS,
  IPC_CHANNELS.STORAGE_SET_QUOTA,
  IPC_CHANNELS.STORAGE_BACKUP,
  IPC_CHANNELS.STORAGE_RESTORE,
  IPC_CHANNELS.SESSIONS_LIST,
  IPC_CHANNELS.SESSIONS_TERMINATE,
];

let cleanupCurrent: (() => void) | null = null;

function removeAllRegisteredHandlers(): void {
  for (const channel of HANDLER_CHANNELS) {
    ipcMain.removeHandler(channel);
  }
}

export function registerHandlers(services: {
  authService: AuthService;
  dashboardService: DashboardService;
}, options?: { guard?: IpcInvokeGuard }): void {
  cleanupCurrent?.();
  removeAllRegisteredHandlers();

  const unregisterAuth = registerAuthHandlers(services.authService, options?.guard);
  const unregisterDashboard = registerDashboardHandlers(services.dashboardService, options?.guard);

  cleanupCurrent = () => {
    unregisterAuth();
    unregisterDashboard();
  };
}

export function unregisterHandlers(): void {
  cleanupCurrent?.();
  cleanupCurrent = null;
  removeAllRegisteredHandlers();
}
