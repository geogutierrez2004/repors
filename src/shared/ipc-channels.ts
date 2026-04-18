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

  // User management channels (single-user mode: mostly disabled)
  USERS_LIST: 'sccfs:users:list',
  USERS_CREATE: 'sccfs:users:create',
  USERS_UPDATE: 'sccfs:users:update',
  USERS_DELETE: 'sccfs:users:delete',
  USERS_RESET_PASSWORD: 'sccfs:users:reset-password',
  USERS_UNLOCK: 'sccfs:users:unlock',

  // Dashboard aggregate stats
  DASHBOARD_STATS: 'sccfs:dashboard:stats',

  // File management
  FILES_LIST: 'sccfs:files:list',
  FILES_UPLOAD: 'sccfs:files:upload',
  FILES_DOWNLOAD: 'sccfs:files:download',
  FILES_VIEW_ENCRYPTED: 'sccfs:files:view-encrypted',
  FILES_VIEW_ENCRYPTED_CLEANUP: 'sccfs:files:view-encrypted-cleanup',
  FILES_DELETE: 'sccfs:files:delete',
  FILES_MOVE: 'sccfs:files:move',

  // Shelf management
  SHELVES_LIST: 'sccfs:shelves:list',
  SHELVES_CREATE: 'sccfs:shelves:create',
  SHELVES_DELETE: 'sccfs:shelves:delete',
  SHELVES_RENAME: 'sccfs:shelves:rename',

  // Activity log
  ACTIVITY_LIST: 'sccfs:activity:list',

  // Storage & backup
  STORAGE_STATS: 'sccfs:storage:stats',
  STORAGE_SET_QUOTA: 'sccfs:storage:set-quota',
  STORAGE_BACKUP: 'sccfs:storage:backup',
  STORAGE_RESTORE: 'sccfs:storage:restore',
  APP_RESTORED: 'sccfs:app:restored',

  // Session management (security dashboard)
  SESSIONS_LIST: 'sccfs:sessions:list',
  SESSIONS_TERMINATE: 'sccfs:sessions:terminate',
} as const;

/** All allowed IPC channel names (for allowlist enforcement). */
export const ALLOWED_CHANNELS: readonly string[] = Object.values(IPC_CHANNELS);

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];
