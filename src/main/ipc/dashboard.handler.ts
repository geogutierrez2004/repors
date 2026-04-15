/**
 * Dashboard IPC handlers.
 *
 * Registers ipcMain.handle() for all sccfs:dashboard:*, sccfs:files:*,
 * sccfs:shelves:*, sccfs:activity:*, sccfs:storage:*, and sccfs:sessions:* channels.
 */
import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import type { IpcResponse } from '../../shared/types';
import { DashboardService } from '../services/dashboard.service';
import { AuthError } from '../services/auth.service';
import { RbacError } from '../services/rbac.service';
import {
  SessionIdOnlySchema,
  FileListSchema,
  FileUploadSchema,
  FileDownloadSchema,
  FileDeleteSchema,
  FileMoveSchema,
  ShelfCreateSchema,
  ShelfDeleteSchema,
  ShelfRenameSchema,
  ActivityListSchema,
  StorageSetQuotaSchema,
  SessionTerminateSchema,
} from './validators';
import { ZodError } from 'zod';

function ok<T>(data: T): IpcResponse<T> {
  return { ok: true, data };
}

function err(code: string, message: string, details?: unknown): IpcResponse {
  return { ok: false, error: { code, message, details } };
}

function handleError(e: unknown): IpcResponse {
  if (e instanceof ZodError) {
    return err('VALIDATION_ERROR', 'Invalid request payload', e.errors);
  }
  if (e instanceof AuthError) {
    return err(e.code, e.message);
  }
  if (e instanceof RbacError) {
    return err(e.code, e.message);
  }
  const message = e instanceof Error ? e.message : 'Unknown error';
  return err('INTERNAL_ERROR', message);
}

function getSenderWindow(event: Electron.IpcMainInvokeEvent): BrowserWindow {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) throw new AuthError('INTERNAL_ERROR', 'No browser window available');
  return win;
}

export function registerDashboardHandlers(dashboardService: DashboardService): void {
  // ── Dashboard stats ──────────────────
  ipcMain.handle(IPC_CHANNELS.DASHBOARD_STATS, async (_event, payload: unknown) => {
    try {
      const { sessionId } = SessionIdOnlySchema.parse(payload);
      return ok(dashboardService.getStats(sessionId));
    } catch (e) {
      return handleError(e);
    }
  });

  // ── Files ───────────────────────────
  ipcMain.handle(IPC_CHANNELS.FILES_LIST, async (_event, payload: unknown) => {
    try {
      const { sessionId, shelfId, search, page, pageSize } = FileListSchema.parse(payload);
      return ok(dashboardService.listFiles(sessionId, { shelfId, search, page, pageSize }));
    } catch (e) {
      return handleError(e);
    }
  });

  ipcMain.handle(IPC_CHANNELS.FILES_UPLOAD, async (event, payload: unknown) => {
    try {
      const { sessionId, shelfId, encrypt } = FileUploadSchema.parse(payload);
      const win = getSenderWindow(event);
      return ok(await dashboardService.uploadFile(sessionId, shelfId, encrypt, win));
    } catch (e) {
      return handleError(e);
    }
  });

  ipcMain.handle(IPC_CHANNELS.FILES_DOWNLOAD, async (event, payload: unknown) => {
    try {
      const { sessionId, fileId } = FileDownloadSchema.parse(payload);
      const win = getSenderWindow(event);
      await dashboardService.downloadFile(sessionId, fileId, win);
      return ok(null);
    } catch (e) {
      return handleError(e);
    }
  });

  ipcMain.handle(IPC_CHANNELS.FILES_DELETE, async (_event, payload: unknown) => {
    try {
      const { sessionId, fileId } = FileDeleteSchema.parse(payload);
      dashboardService.deleteFile(sessionId, fileId);
      return ok(null);
    } catch (e) {
      return handleError(e);
    }
  });

  ipcMain.handle(IPC_CHANNELS.FILES_MOVE, async (_event, payload: unknown) => {
    try {
      const { sessionId, fileId, shelfId } = FileMoveSchema.parse(payload);
      return ok(dashboardService.moveFile(sessionId, fileId, shelfId));
    } catch (e) {
      return handleError(e);
    }
  });

  // ── Shelves ──────────────────────────
  ipcMain.handle(IPC_CHANNELS.SHELVES_LIST, async (_event, payload: unknown) => {
    try {
      const { sessionId } = SessionIdOnlySchema.parse(payload);
      return ok(dashboardService.listShelves(sessionId));
    } catch (e) {
      return handleError(e);
    }
  });

  ipcMain.handle(IPC_CHANNELS.SHELVES_CREATE, async (_event, payload: unknown) => {
    try {
      const { sessionId, name } = ShelfCreateSchema.parse(payload);
      return ok(dashboardService.createShelf(sessionId, name));
    } catch (e) {
      return handleError(e);
    }
  });

  ipcMain.handle(IPC_CHANNELS.SHELVES_DELETE, async (_event, payload: unknown) => {
    try {
      const { sessionId, shelfId } = ShelfDeleteSchema.parse(payload);
      dashboardService.deleteShelf(sessionId, shelfId);
      return ok(null);
    } catch (e) {
      return handleError(e);
    }
  });

  ipcMain.handle(IPC_CHANNELS.SHELVES_RENAME, async (_event, payload: unknown) => {
    try {
      const { sessionId, shelfId, name } = ShelfRenameSchema.parse(payload);
      return ok(dashboardService.renameShelf(sessionId, shelfId, name));
    } catch (e) {
      return handleError(e);
    }
  });

  // ── Activity log ─────────────────────
  ipcMain.handle(IPC_CHANNELS.ACTIVITY_LIST, async (_event, payload: unknown) => {
    try {
      const { sessionId, userId, action, dateFrom, dateTo, page, pageSize } =
        ActivityListSchema.parse(payload);
      return ok(dashboardService.listActivity(sessionId, { userId, action, dateFrom, dateTo, page, pageSize }));
    } catch (e) {
      return handleError(e);
    }
  });

  // ── Storage & backup ─────────────────
  ipcMain.handle(IPC_CHANNELS.STORAGE_STATS, async (_event, payload: unknown) => {
    try {
      const { sessionId } = SessionIdOnlySchema.parse(payload);
      return ok(dashboardService.getStorageStats(sessionId));
    } catch (e) {
      return handleError(e);
    }
  });

  ipcMain.handle(IPC_CHANNELS.STORAGE_SET_QUOTA, async (_event, payload: unknown) => {
    try {
      const { sessionId, quotaBytes } = StorageSetQuotaSchema.parse(payload);
      dashboardService.setQuota(sessionId, quotaBytes);
      return ok(null);
    } catch (e) {
      return handleError(e);
    }
  });

  ipcMain.handle(IPC_CHANNELS.STORAGE_BACKUP, async (event, payload: unknown) => {
    try {
      const { sessionId } = SessionIdOnlySchema.parse(payload);
      const win = getSenderWindow(event);
      return ok(await dashboardService.backup(sessionId, win));
    } catch (e) {
      return handleError(e);
    }
  });

  ipcMain.handle(IPC_CHANNELS.STORAGE_RESTORE, async (event, payload: unknown) => {
    try {
      const { sessionId } = SessionIdOnlySchema.parse(payload);
      const win = getSenderWindow(event);
      await dashboardService.restore(sessionId, win);
      return ok(null);
    } catch (e) {
      return handleError(e);
    }
  });

  // ── Sessions ─────────────────────────
  ipcMain.handle(IPC_CHANNELS.SESSIONS_LIST, async (_event, payload: unknown) => {
    try {
      const { sessionId } = SessionIdOnlySchema.parse(payload);
      return ok(dashboardService.listActiveSessions(sessionId));
    } catch (e) {
      return handleError(e);
    }
  });

  ipcMain.handle(IPC_CHANNELS.SESSIONS_TERMINATE, async (_event, payload: unknown) => {
    try {
      const { sessionId, targetSessionId } = SessionTerminateSchema.parse(payload);
      dashboardService.terminateSession(sessionId, targetSessionId);
      return ok(null);
    } catch (e) {
      return handleError(e);
    }
  });
}
