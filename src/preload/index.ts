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
import type { IpcResponse, LoginResponse, SafeUser } from '../shared/types';

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
};

contextBridge.exposeInMainWorld('sccfs', api);

/** TypeScript declaration for renderer usage. */
export type SccfsApi = typeof api;
