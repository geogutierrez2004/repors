/**
 * IPC channel definitions for SCCFS.
 * Namespace prefix: sccfs:
 * Pattern: domain:verb
 */
export const IPC_CHANNELS = {
  // Authentication channels
  AUTH_LOGIN: 'sccfs:auth:login',
  AUTH_LOGOUT: 'sccfs:auth:logout',
  AUTH_VALIDATE_SESSION: 'sccfs:auth:validate-session',
  AUTH_CHANGE_PASSWORD: 'sccfs:auth:change-password',
  AUTH_GET_CURRENT_USER: 'sccfs:auth:get-current-user',

  // User management channels (admin only)
  USERS_LIST: 'sccfs:users:list',
  USERS_CREATE: 'sccfs:users:create',
  USERS_UPDATE: 'sccfs:users:update',
  USERS_DELETE: 'sccfs:users:delete',
  USERS_RESET_PASSWORD: 'sccfs:users:reset-password',
  USERS_UNLOCK: 'sccfs:users:unlock',
} as const;

/** All allowed IPC channel names (for allowlist enforcement). */
export const ALLOWED_CHANNELS: readonly string[] = Object.values(IPC_CHANNELS);

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];
