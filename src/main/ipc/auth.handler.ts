/**
 * Auth IPC handlers.
 *
 * Registers ipcMain.handle() for all sccfs:auth:* and sccfs:users:* channels.
 * Each handler validates its payload with zod and returns a normalized response envelope.
 */
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import type { IpcResponse } from '../../shared/types';
import { AuthService, AuthError } from '../services/auth.service';
import {
  LoginSchema,
  LogoutSchema,
  ValidateSessionSchema,
  ChangePasswordSchema,
  GetCurrentUserSchema,
  UpdateUserSchema,
  DeleteUserSchema,
  ResetPasswordSchema,
  UnlockUserSchema,
  ListUsersSchema,
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
  const message = e instanceof Error ? e.message : 'Unknown error';
  return err('INTERNAL_ERROR', message);
}

type InvokeGuard = <T>(invoke: () => Promise<IpcResponse<T>>) => Promise<IpcResponse<T>>;

const passthroughGuard: InvokeGuard = async <T>(invoke: () => Promise<IpcResponse<T>>) => invoke();

const AUTH_CHANNELS = [
  IPC_CHANNELS.AUTH_LOGIN,
  IPC_CHANNELS.AUTH_LOGOUT,
  IPC_CHANNELS.AUTH_VALIDATE_SESSION,
  IPC_CHANNELS.AUTH_GET_CURRENT_USER,
  IPC_CHANNELS.AUTH_CHANGE_PASSWORD,
  IPC_CHANNELS.USERS_LIST,
  IPC_CHANNELS.USERS_UPDATE,
  IPC_CHANNELS.USERS_DELETE,
  IPC_CHANNELS.USERS_RESET_PASSWORD,
  IPC_CHANNELS.USERS_UNLOCK,
] as const;

export function registerAuthHandlers(authService: AuthService, guard: InvokeGuard = passthroughGuard): () => void {
  // ── Login ────────────────────────────
  ipcMain.handle(IPC_CHANNELS.AUTH_LOGIN, (_event, payload: unknown) =>
    guard(async () => {
      try {
        const { username, password } = LoginSchema.parse(payload);
        const result = await authService.login(username, password);
        return ok(result);
      } catch (e) {
        return handleError(e);
      }
    }));

  // ── Logout ───────────────────────────
  ipcMain.handle(IPC_CHANNELS.AUTH_LOGOUT, (_event, payload: unknown) =>
    guard(async () => {
      try {
        const { sessionId } = LogoutSchema.parse(payload);
        authService.logout(sessionId);
        return ok(null);
      } catch (e) {
        return handleError(e);
      }
    }));

  // ── Validate session ─────────────────
  ipcMain.handle(IPC_CHANNELS.AUTH_VALIDATE_SESSION, (_event, payload: unknown) =>
    guard(async () => {
      try {
        const { sessionId } = ValidateSessionSchema.parse(payload);
        const session = authService.validateSession(sessionId);
        return ok(session ? { valid: true } : { valid: false });
      } catch (e) {
        return handleError(e);
      }
    }));

  // ── Get current user ─────────────────
  ipcMain.handle(IPC_CHANNELS.AUTH_GET_CURRENT_USER, (_event, payload: unknown) =>
    guard(async () => {
      try {
        const { sessionId } = GetCurrentUserSchema.parse(payload);
        const user = authService.getCurrentUser(sessionId);
        if (!user) return err('INVALID_SESSION', 'Session expired or invalid');
        return ok(user);
      } catch (e) {
        return handleError(e);
      }
    }));

  // ── Change password ──────────────────
  ipcMain.handle(IPC_CHANNELS.AUTH_CHANGE_PASSWORD, (_event, payload: unknown) =>
    guard(async () => {
      try {
        const { sessionId, currentPassword, newPassword } = ChangePasswordSchema.parse(payload);
        await authService.changePassword(sessionId, currentPassword, newPassword);
        return ok(null);
      } catch (e) {
        return handleError(e);
      }
    }));

  // ── User management ──────────────────

  ipcMain.handle(IPC_CHANNELS.USERS_LIST, (_event, payload: unknown) =>
    guard(async () => {
      try {
        const { sessionId } = ListUsersSchema.parse(payload);
        const users = authService.listUsers(sessionId);
        return ok(users);
      } catch (e) {
        return handleError(e);
      }
    }));

  ipcMain.handle(IPC_CHANNELS.USERS_UPDATE, (_event, payload: unknown) =>
    guard(async () => {
      try {
        const { sessionId, userId, ...updates } = UpdateUserSchema.parse(payload);
        const user = authService.updateUser(sessionId, userId, updates);
        return ok(user);
      } catch (e) {
        return handleError(e);
      }
    }));

  ipcMain.handle(IPC_CHANNELS.USERS_DELETE, (_event, payload: unknown) =>
    guard(async () => {
      try {
        const { sessionId, userId } = DeleteUserSchema.parse(payload);
        authService.deleteUser(sessionId, userId);
        return ok(null);
      } catch (e) {
        return handleError(e);
      }
    }));

  ipcMain.handle(IPC_CHANNELS.USERS_RESET_PASSWORD, (_event, payload: unknown) =>
    guard(async () => {
      try {
        const { sessionId, userId, newPassword } = ResetPasswordSchema.parse(payload);
        await authService.resetPassword(sessionId, userId, newPassword);
        return ok(null);
      } catch (e) {
        return handleError(e);
      }
    }));

  ipcMain.handle(IPC_CHANNELS.USERS_UNLOCK, (_event, payload: unknown) =>
    guard(async () => {
      try {
        const { sessionId, userId } = UnlockUserSchema.parse(payload);
        const user = authService.unlockUser(sessionId, userId);
        return ok(user);
      } catch (e) {
        return handleError(e);
      }
    }));

  return () => {
    for (const channel of AUTH_CHANNELS) {
      ipcMain.removeHandler(channel);
    }
  };
}
