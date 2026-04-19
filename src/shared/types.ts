import { Role } from './constants';

// ────────────────────────────────────────
// IPC response envelope
// ────────────────────────────────────────

/** Normalized error shape returned in IPC responses. */
export interface IpcError {
  code: string;
  message: string;
  details?: unknown;
}

/** Success IPC response. */
export interface IpcOk<T = unknown> {
  ok: true;
  data: T;
  error?: undefined;
}

/** Failure IPC response. */
export interface IpcErr {
  ok: false;
  data?: undefined;
  error: IpcError;
}

/** Uniform IPC response envelope. */
export type IpcResponse<T = unknown> = IpcOk<T> | IpcErr;

// ────────────────────────────────────────
// Domain models
// ────────────────────────────────────────

/** Stored user record (password hash is never sent to renderer). */
export interface UserRecord {
  id: string;
  username: string;
  password_hash: string;
  role: Role;
  is_active: boolean;
  failed_attempts: number;
  locked_until: number | null;
  created_at: string;
  updated_at: string;
}

/** Safe user info exposed to renderer. */
export interface SafeUser {
  id: string;
  username: string;
  role: Role;
  is_active: boolean;
  locked_until: number | null;
  created_at: string;
  updated_at: string;
}

/** In-memory session data. */
export interface Session {
  sessionId: string;
  userId: string;
  role: Role;
  createdAt: number;
  lastActivity: number;
}

/** Safe session info exposed to renderer (no sensitive internals). */
export interface SessionInfo {
  sessionId: string;
  userId: string;
  username: string;
  role: string;
  createdAt: number;
  lastActivity: number;
}

/** File record exposed to renderer. */
export interface FileRecord {
  id: string;
  original_name: string;
  original_extension: string | null;
  stored_name: string;
  mime_type: string | null;
  size_bytes: number;
  sha256: string;
  shelf_id: string;
  shelf_name: string;
  is_encrypted: boolean;
  created_at: string;
  updated_at: string;
  uploaded_by: string | null;
}

export type SourceHandlingMode = 'keep_original' | 'move_to_system' | 'ask_each_time';

export interface FileUploadItemResult {
  source_path: string;
  source_name: string;
  success: boolean;
  removed_original: boolean;
  mode: SourceHandlingMode;
  file?: FileRecord;
  error?: IpcError;
}

export interface FileUploadResult {
  files: FileUploadItemResult[];
}

export interface SecureTempViewResult {
  viewId: string;
  fileName: string;
  mimeType: string | null;
  contentBase64: string;
  cleanupAfterMs: number;
}

export interface SecureTempViewCleanupResult {
  deleted: boolean;
}

/** Shelf record with aggregate counts. */
export interface ShelfRecord {
  id: string;
  name: string;
  is_system: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  file_count: number;
  total_size_bytes: number;
}

/** Activity log entry. */
export interface ActivityRecord {
  id: string;
  user_id: string | null;
  username: string | null;
  action: string;
  detail: string | null;
  created_at: string;
}

/** Storage statistics. */
export interface StorageStats {
  used_bytes: number;
  quota_bytes: number;
  file_count: number;
  by_shelf: Array<{ shelf_id: string; shelf_name: string; size_bytes: number; file_count: number }>;
  trend: Array<{ date: string; cumulative_bytes: number }>;
}

/** Dashboard overview aggregates. */
export interface DashboardStats {
  active_sessions: number;
  total_files: number;
  total_size_bytes: number;
  pending_uploads: number;
  failed_uploads_24h: number;
  locked_accounts: number;
  recent_activity: ActivityRecord[];
  file_ops_7d: Array<{ date: string; uploads: number; downloads: number; failures: number }>;
}

/** Security tab integrity-focused aggregates. */
export interface SecurityIntegrityStats {
  total_files: number;
  encrypted_files: number;
  unencrypted_files: number;
  pending_uploads: number;
  failed_uploads_24h: number;
  failed_uploads_7d: number;
  storage_used_bytes: number;
  storage_quota_bytes: number;
  storage_used_percent: number;
  lockout_events_24h: number;
  last_backup_at: string | null;
  upload_failures_by_reason: Array<{ reason: string; count: number }>;
  threat_activity_by_hour: Array<{ hour: string; count: number }>;
  critical_events: ActivityRecord[];
}

/** Configurable thresholds used to color security integrity cards. */
export interface SecurityThresholdSettings {
  storage_warn_percent: number;
  storage_danger_percent: number;
  upload_fail_warn_24h: number;
  upload_fail_danger_24h: number;
}

export const DEFAULT_SECURITY_THRESHOLD_SETTINGS: SecurityThresholdSettings = {
  storage_warn_percent: 75,
  storage_danger_percent: 90,
  upload_fail_warn_24h: 1,
  upload_fail_danger_24h: 5,
};

/** Generic paginated result wrapper. */
export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// ────────────────────────────────────────
// Auth payloads
// ────────────────────────────────────────

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  sessionId: string;
  user: SafeUser;
}

export interface ChangePasswordRequest {
  sessionId: string;
  currentPassword: string;
  newPassword: string;
}

// ────────────────────────────────────────
// User management payloads
// ────────────────────────────────────────

export interface CreateUserRequest {
  sessionId: string;
  username: string;
  password: string;
  role: Role;
}

export interface UpdateUserRequest {
  sessionId: string;
  userId: string;
  role?: Role;
  is_active?: boolean;
}

export interface ResetPasswordRequest {
  sessionId: string;
  userId: string;
  newPassword: string;
}
