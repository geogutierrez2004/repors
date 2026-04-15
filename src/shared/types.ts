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
