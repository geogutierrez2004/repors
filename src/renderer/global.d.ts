/**
 * Global type declarations for the renderer process.
 * Declares the window.sccfs API injected by the preload script.
 */
import type {
  IpcResponse,
  LoginResponse,
  SafeUser,
  FileRecord,
  ShelfRecord,
  ActivityRecord,
  StorageStats,
  DashboardStats,
  SessionInfo,
  PaginatedResult,
  FileUploadResult,
  SecureTempViewResult,
  SourceHandlingMode,
} from '../shared/types';

declare global {
  interface Window {
    sccfs: {
      auth: {
        login(username: string, password: string): Promise<IpcResponse<LoginResponse>>;
        logout(sessionId: string): Promise<IpcResponse<null>>;
        validateSession(sessionId: string): Promise<IpcResponse<{ valid: boolean }>>;
        getCurrentUser(sessionId: string): Promise<IpcResponse<SafeUser>>;
        changePassword(
          sessionId: string,
          currentPassword: string,
          newPassword: string,
        ): Promise<IpcResponse<null>>;
      };

      users: {
        list(sessionId: string): Promise<IpcResponse<SafeUser[]>>;
        update(
          sessionId: string,
          userId: string,
          updates: { role?: string; is_active?: boolean },
        ): Promise<IpcResponse<SafeUser>>;
        delete(sessionId: string, userId: string): Promise<IpcResponse<null>>;
        resetPassword(
          sessionId: string,
          userId: string,
          newPassword: string,
        ): Promise<IpcResponse<null>>;
        unlock(sessionId: string, userId: string): Promise<IpcResponse<SafeUser>>;
      };

      dashboard: {
        stats(sessionId: string): Promise<IpcResponse<DashboardStats>>;
      };

      files: {
        list(
          sessionId: string,
          opts: { shelfId?: string; search?: string; page?: number; pageSize?: number },
        ): Promise<IpcResponse<PaginatedResult<FileRecord>>>;
        upload(
          sessionId: string,
          shelfId: string,
          encrypt: boolean,
          sourceHandlingMode?: SourceHandlingMode,
          confirmPermanentDelete?: boolean,
        ): Promise<IpcResponse<FileUploadResult>>;
        download(sessionId: string, fileId: string): Promise<IpcResponse<null>>;
        viewEncrypted(sessionId: string, fileId: string): Promise<IpcResponse<SecureTempViewResult>>;
        delete(sessionId: string, fileId: string): Promise<IpcResponse<null>>;
        move(
          sessionId: string,
          fileId: string,
          shelfId: string,
        ): Promise<IpcResponse<FileRecord>>;
      };

      shelves: {
        list(sessionId: string): Promise<IpcResponse<ShelfRecord[]>>;
        create(sessionId: string, name: string): Promise<IpcResponse<ShelfRecord>>;
        delete(sessionId: string, shelfId: string): Promise<IpcResponse<null>>;
        rename(
          sessionId: string,
          shelfId: string,
          name: string,
        ): Promise<IpcResponse<ShelfRecord>>;
      };

      activity: {
        list(
          sessionId: string,
          opts: {
            userId?: string;
            action?: string;
            dateFrom?: string;
            dateTo?: string;
            page?: number;
            pageSize?: number;
          },
        ): Promise<IpcResponse<PaginatedResult<ActivityRecord>>>;
      };

      storage: {
        stats(sessionId: string): Promise<IpcResponse<StorageStats>>;
        setQuota(sessionId: string, quotaBytes: number): Promise<IpcResponse<null>>;
        backup(sessionId: string): Promise<IpcResponse<{ path: string }>>;
        restore(sessionId: string): Promise<IpcResponse<null>>;
      };

      sessions: {
        list(sessionId: string): Promise<IpcResponse<SessionInfo[]>>;
        terminate(sessionId: string, targetSessionId: string): Promise<IpcResponse<null>>;
      };

      app: {
        onRestored(callback: (payload: { sessionInvalidated: boolean }) => void): () => void;
      };
    };
  }
}
