/**
 * Preload script – exposes a constrained API surface via contextBridge (spec §2.3).
 *
 * Rules:
 * - Never expose raw ipcRenderer
 * - Return unsubscribe handlers for event subscriptions
 * - Only expose channels from the allowlist
 */
import { contextBridge, ipcRenderer } from 'electron';
import { ALLOWED_CHANNELS } from '../shared/ipc-channels';
import { IPC_CHANNELS } from '../shared/ipc-channels';
import type {
  IpcResponse,
  LoginResponse,
  SafeUser,
  FileRecord,
  ShelfRecord,
  ActivityRecord,
  StorageStats,
  DashboardStats,
  SecurityIntegrityStats,
  SecurityThresholdSettings,
  SessionInfo,
  PaginatedResult,
  FileUploadResult,
  SecureTempViewResult,
  SecureTempViewCleanupResult,
  SourceHandlingMode,
} from '../shared/types';

/**
 * Safe invoke wrapper – validates channel against allowlist.
 */
function safeInvoke<T = unknown>(channel: string, payload?: unknown): Promise<IpcResponse<T>> {
  if (!ALLOWED_CHANNELS.includes(channel)) {
    return Promise.resolve({
      ok: false,
      error: { code: 'INVALID_CHANNEL', message: `Channel '${channel}' is not allowed` },
    });
  }
  return ipcRenderer.invoke(channel, payload) as Promise<IpcResponse<T>>;
}

const api = {
  auth: {
    login: (username: string, password: string) =>
      safeInvoke<LoginResponse>(IPC_CHANNELS.AUTH_LOGIN, { username, password }),

    logout: (sessionId: string) =>
      safeInvoke(IPC_CHANNELS.AUTH_LOGOUT, { sessionId }),

    validateSession: (sessionId: string) =>
      safeInvoke<{ valid: boolean }>(IPC_CHANNELS.AUTH_VALIDATE_SESSION, { sessionId }),

    getCurrentUser: (sessionId: string) =>
      safeInvoke<SafeUser>(IPC_CHANNELS.AUTH_GET_CURRENT_USER, { sessionId }),

    changePassword: (sessionId: string, currentPassword: string, newPassword: string) =>
      safeInvoke(IPC_CHANNELS.AUTH_CHANGE_PASSWORD, { sessionId, currentPassword, newPassword }),
  },

  users: {
    list: (sessionId: string) =>
      safeInvoke<SafeUser[]>(IPC_CHANNELS.USERS_LIST, { sessionId }),

    create: (sessionId: string, username: string, password: string, role: string) =>
      safeInvoke<SafeUser>(IPC_CHANNELS.USERS_CREATE, { sessionId, username, password, role }),

    update: (sessionId: string, userId: string, updates: { role?: string; is_active?: boolean }) =>
      safeInvoke<SafeUser>(IPC_CHANNELS.USERS_UPDATE, { sessionId, userId, ...updates }),

    delete: (sessionId: string, userId: string) =>
      safeInvoke(IPC_CHANNELS.USERS_DELETE, { sessionId, userId }),

    resetPassword: (sessionId: string, userId: string, newPassword: string) =>
      safeInvoke(IPC_CHANNELS.USERS_RESET_PASSWORD, { sessionId, userId, newPassword }),

    unlock: (sessionId: string, userId: string) =>
      safeInvoke<SafeUser>(IPC_CHANNELS.USERS_UNLOCK, { sessionId, userId }),
  },

  dashboard: {
    stats: (sessionId: string) =>
      safeInvoke<DashboardStats>(IPC_CHANNELS.DASHBOARD_STATS, { sessionId }),

    securityIntegrityStats: (sessionId: string) =>
      safeInvoke<SecurityIntegrityStats>(IPC_CHANNELS.SECURITY_INTEGRITY_STATS, { sessionId }),

    getSecurityThresholdSettings: (sessionId: string) =>
      safeInvoke<SecurityThresholdSettings>(IPC_CHANNELS.SECURITY_THRESHOLD_GET, { sessionId }),

    setSecurityThresholdSettings: (sessionId: string, settings: SecurityThresholdSettings) =>
      safeInvoke<SecurityThresholdSettings>(IPC_CHANNELS.SECURITY_THRESHOLD_SET, { sessionId, settings }),
  },

  files: {
    list: (
      sessionId: string,
      opts: { shelfId?: string; search?: string; page?: number; pageSize?: number },
    ) =>
      safeInvoke<PaginatedResult<FileRecord>>(IPC_CHANNELS.FILES_LIST, {
        sessionId,
        ...opts,
        page: opts.page ?? 1,
        pageSize: opts.pageSize ?? 25,
      }),

    upload: (
      sessionId: string,
      shelfId: string,
      encrypt: boolean,
      encryptionPassword?: string,
      sourceHandlingMode: SourceHandlingMode = 'keep_original',
      confirmPermanentDelete = false,
      dragDropFilePaths?: string[],
    ) =>
      safeInvoke<FileUploadResult>(IPC_CHANNELS.FILES_UPLOAD, {
        sessionId,
        shelfId,
        encrypt,
        encryptionPassword,
        sourceHandlingMode,
        confirmPermanentDelete,
        dragDropFilePaths,
      }),

    download: (sessionId: string, fileId: string, decryptionPassword?: string) =>
      safeInvoke(IPC_CHANNELS.FILES_DOWNLOAD, { sessionId, fileId, decryptionPassword }),

    viewEncrypted: (sessionId: string, fileId: string, decryptionPassword: string) =>
      safeInvoke<SecureTempViewResult>(IPC_CHANNELS.FILES_VIEW_ENCRYPTED, { sessionId, fileId, decryptionPassword }),

    cleanupEncryptedView: (sessionId: string, viewId: string) =>
      safeInvoke<SecureTempViewCleanupResult>(IPC_CHANNELS.FILES_VIEW_ENCRYPTED_CLEANUP, { sessionId, viewId }),

    delete: (sessionId: string, fileId: string) =>
      safeInvoke(IPC_CHANNELS.FILES_DELETE, { sessionId, fileId }),

    move: (sessionId: string, fileId: string, shelfId: string) =>
      safeInvoke<FileRecord>(IPC_CHANNELS.FILES_MOVE, { sessionId, fileId, shelfId }),

    rename: (sessionId: string, fileId: string, newName: string) =>
      safeInvoke<FileRecord>(IPC_CHANNELS.FILES_RENAME, { sessionId, fileId, newName }),
  },

  shelves: {
    list: (sessionId: string) =>
      safeInvoke<ShelfRecord[]>(IPC_CHANNELS.SHELVES_LIST, { sessionId }),

    create: (sessionId: string, name: string) =>
      safeInvoke<ShelfRecord>(IPC_CHANNELS.SHELVES_CREATE, { sessionId, name }),

    delete: (sessionId: string, shelfId: string, opts?: { action?: 'move' | 'temp'; targetShelfId?: string }) =>
      safeInvoke(IPC_CHANNELS.SHELVES_DELETE, { sessionId, shelfId, ...opts }),

    checkContents: (sessionId: string, shelfId: string) =>
      safeInvoke<{ fileCount: number; files: string[] }>(IPC_CHANNELS.SHELVES_CHECK_CONTENTS, {
        sessionId,
        shelfId,
      }),

    rename: (sessionId: string, shelfId: string, name: string) =>
      safeInvoke<ShelfRecord>(IPC_CHANNELS.SHELVES_RENAME, { sessionId, shelfId, name }),
  },

  activity: {
    list: (
      sessionId: string,
      opts: {
        userId?: string;
        action?: string;
        dateFrom?: string;
        dateTo?: string;
        page?: number;
        pageSize?: number;
      },
    ) =>
      safeInvoke<PaginatedResult<ActivityRecord>>(IPC_CHANNELS.ACTIVITY_LIST, {
        sessionId,
        ...opts,
        page: opts.page ?? 1,
        pageSize: opts.pageSize ?? 50,
      }),
  },

  storage: {
    stats: (sessionId: string) =>
      safeInvoke<StorageStats>(IPC_CHANNELS.STORAGE_STATS, { sessionId }),

    setQuota: (sessionId: string, quotaBytes: number) =>
      safeInvoke(IPC_CHANNELS.STORAGE_SET_QUOTA, { sessionId, quotaBytes }),

    backup: (sessionId: string) =>
      safeInvoke<{ path: string }>(IPC_CHANNELS.STORAGE_BACKUP, { sessionId }),

    restore: (sessionId: string) =>
      safeInvoke(IPC_CHANNELS.STORAGE_RESTORE, { sessionId }),

    getDriveStatus: (sessionId: string) =>
      safeInvoke<Array<{ drive: string; usedPercent: number; warningLevel: 'ok' | 'warning' | 'critical' }>>(
        IPC_CHANNELS.STORAGE_DRIVE_STATUS,
        { sessionId },
      ),
  },

  sessions: {
    list: (sessionId: string) =>
      safeInvoke<SessionInfo[]>(IPC_CHANNELS.SESSIONS_LIST, { sessionId }),

    terminate: (sessionId: string, targetSessionId: string) =>
      safeInvoke(IPC_CHANNELS.SESSIONS_TERMINATE, { sessionId, targetSessionId }),
  },

  app: {
    onRestored: (callback: (payload: { sessionInvalidated: boolean }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: { sessionInvalidated: boolean }) => {
        callback(payload);
      };
      ipcRenderer.on(IPC_CHANNELS.APP_RESTORED, listener);
      return () => {
        ipcRenderer.off(IPC_CHANNELS.APP_RESTORED, listener);
      };
    },
  },

  // Store dropped file paths
  dropZone: {
    getDroppedFiles: () => ipcRenderer.invoke('get-dropped-files'),
  },
};

// Listen for drop events in the renderer and relay to main process
let droppedFiles: string[] = [];
document.addEventListener(
  'drop',
  (e) => {
    if (e.dataTransfer?.files) {
      const files = Array.from(e.dataTransfer.files);
      // Try to extract file paths from File objects (Electron-specific)
      const paths = files
        .map((f: any) => {
          // In Electron, dropped files have a .path property
          if (f.path) return f.path;
          // Fallback: try .filePath
          if (f.filePath) return f.filePath;
          // Last resort: use the name (won't work but better than nothing)
          return null;
        })
        .filter((p): p is string => p !== null && p.length > 0);
      if (paths.length > 0) {
        droppedFiles = paths;
        ipcRenderer.invoke('store-dropped-files', paths).catch(() => {
          // Silently handle IPC errors
        });
      }
    }
  },
  true,
);

contextBridge.exposeInMainWorld('sccfs', api);
contextBridge.exposeInMainWorld('getDroppedFiles', () => droppedFiles);

/** TypeScript declaration for renderer usage. */
export type SccfsApi = typeof api;
