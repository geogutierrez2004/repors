/**
 * Integration tests for AuthService.
 *
 * Uses an in-memory SQLite database to test the full auth flow.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { up as initialSchema } from '../../src/main/database/migrations/001-initial-schema';
import { AuthService, AuthError } from '../../src/main/services/auth.service';
import { clearAllSessions } from '../../src/main/services/session.service';
import { Role, AUTH_CONSTANTS } from '../../src/shared/constants';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initialSchema(db);
  return db;
}

describe('AuthService', () => {
  let db: Database.Database;
  let auth: AuthService;

  beforeEach(() => {
    clearAllSessions();
    db = createTestDb();
    auth = new AuthService(db);
  });

  // ── Seed and Login ────────────────────

  describe('seedDefaultAdmin + login', () => {
    it('should seed a default admin and allow login', async () => {
      await auth.seedDefaultAdmin('fs_adm1', 'admin123');
      const result = await auth.login('fs_adm1', 'admin123');
      expect(result.sessionId).toBeDefined();
      expect(result.user.username).toBe('fs_adm1');
      expect(result.user.role).toBe(Role.ADMIN);
    });

    it('should not re-seed if users already exist', async () => {
      await auth.seedDefaultAdmin('fs_adm1', 'admin123');
      await auth.seedDefaultAdmin('admin2', 'Other@1234');
      const users = db.prepare('SELECT COUNT(*) as cnt FROM users').get() as { cnt: number };
      expect(users.cnt).toBe(1);
    });
  });

  // ── Login edge cases ──────────────────

  describe('login', () => {
    beforeEach(async () => {
      await auth.seedDefaultAdmin('fs_adm1', 'admin123');
    });

    it('should reject invalid username', async () => {
      await expect(auth.login('nonexistent', 'admin123')).rejects.toThrow(AuthError);
      await expect(auth.login('nonexistent', 'admin123')).rejects.toMatchObject({
        code: 'INVALID_CREDENTIALS',
      });
    });

    it('should reject invalid password', async () => {
      await expect(auth.login('fs_adm1', 'WrongPass@1')).rejects.toThrow(AuthError);
    });

    it('should be case-insensitive for username', async () => {
      const result = await auth.login('FS_ADM1', 'admin123');
      expect(result.user.username).toBe('fs_adm1');
    });

    it('should lock account after max failed attempts', async () => {
      for (let i = 0; i < AUTH_CONSTANTS.MAX_FAILED_ATTEMPTS; i++) {
        await expect(auth.login('fs_adm1', 'WrongPass@1')).rejects.toThrow(AuthError);
      }
      // Next attempt should be locked
      await expect(auth.login('fs_adm1', 'admin123')).rejects.toMatchObject({
        code: 'ACCOUNT_LOCKED',
      });
    });

    it('should reject login for disabled account', async () => {
      // Login as admin, then disable the admin account via direct DB
      db.prepare('UPDATE users SET is_active = 0 WHERE username = ?').run('fs_adm1');
      await expect(auth.login('fs_adm1', 'admin123')).rejects.toMatchObject({
        code: 'ACCOUNT_DISABLED',
      });
    });
  });

  // ── Logout ────────────────────────────

  describe('logout', () => {
    it('should invalidate session after logout', async () => {
      await auth.seedDefaultAdmin('fs_adm1', 'admin123');
      const { sessionId } = await auth.login('fs_adm1', 'admin123');
      auth.logout(sessionId);
      const session = auth.validateSession(sessionId);
      expect(session).toBeNull();
    });
  });

  // ── Session validation ────────────────

  describe('validateSession', () => {
    it('should validate an active session', async () => {
      await auth.seedDefaultAdmin('fs_adm1', 'admin123');
      const { sessionId } = await auth.login('fs_adm1', 'admin123');
      const session = auth.validateSession(sessionId);
      expect(session).not.toBeNull();
      expect(session!.role).toBe(Role.ADMIN);
    });

    it('should return null for invalid session id', () => {
      expect(auth.validateSession('00000000-0000-4000-a000-000000000000')).toBeNull();
    });
  });

  // ── Get current user ──────────────────

  describe('getCurrentUser', () => {
    it('should return the current user for a valid session', async () => {
      await auth.seedDefaultAdmin('fs_adm1', 'admin123');
      const { sessionId } = await auth.login('fs_adm1', 'admin123');
      const user = auth.getCurrentUser(sessionId);
      expect(user).not.toBeNull();
      expect(user!.username).toBe('fs_adm1');
    });

    it('should return null for an invalid session', () => {
      expect(auth.getCurrentUser('00000000-0000-4000-a000-000000000000')).toBeNull();
    });
  });

  // ── Change password ───────────────────

  describe('changePassword', () => {
    it('should allow changing password with valid current password', async () => {
      await auth.seedDefaultAdmin('fs_adm1', 'admin123');
      const { sessionId } = await auth.login('fs_adm1', 'admin123');
      await auth.changePassword(sessionId, 'admin123', 'NewPass@5678');
      // Old password should no longer work
      auth.logout(sessionId);
      await expect(auth.login('fs_adm1', 'admin123')).rejects.toThrow(AuthError);
      // New password should work
      const result = await auth.login('fs_adm1', 'NewPass@5678');
      expect(result.user.username).toBe('fs_adm1');
    });

    it('should reject when current password is wrong', async () => {
      await auth.seedDefaultAdmin('fs_adm1', 'admin123');
      const { sessionId } = await auth.login('fs_adm1', 'admin123');
      await expect(
        auth.changePassword(sessionId, 'WrongPass@1', 'NewPass@5678'),
      ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    });

    it('should reject when new password fails policy', async () => {
      await auth.seedDefaultAdmin('fs_adm1', 'admin123');
      const { sessionId } = await auth.login('fs_adm1', 'admin123');
      await expect(
        auth.changePassword(sessionId, 'admin123', 'weak'),
      ).rejects.toMatchObject({ code: 'PASSWORD_POLICY' });
    });
  });

  // ── Single-user mode ──────────────────

  describe('single-user mode restrictions', () => {
    it('should reject creating users', async () => {
      await auth.seedDefaultAdmin('fs_adm1', 'admin123');
      const { sessionId } = await auth.login('fs_adm1', 'admin123');
      await expect(
        auth.createUser(sessionId, 'staff1', 'StaffPass@1', Role.STAFF),
      ).rejects.toMatchObject({ code: 'SINGLE_USER_ONLY' });
    });

    it('should reject updating users', async () => {
      await auth.seedDefaultAdmin('fs_adm1', 'admin123');
      const { sessionId } = await auth.login('fs_adm1', 'admin123');
      const currentUser = auth.getCurrentUser(sessionId);
      expect(() =>
        auth.updateUser(sessionId, currentUser!.id, { is_active: false }),
      ).toThrowError(AuthError);
      expect(() =>
        auth.updateUser(sessionId, currentUser!.id, { is_active: false }),
      ).toThrowError(/one static user account only/i);
    });

    it('should reject deleting users', async () => {
      await auth.seedDefaultAdmin('fs_adm1', 'admin123');
      const { sessionId } = await auth.login('fs_adm1', 'admin123');
      const currentUser = auth.getCurrentUser(sessionId);
      expect(() => auth.deleteUser(sessionId, currentUser!.id)).toThrowError(AuthError);
      expect(() => auth.deleteUser(sessionId, currentUser!.id)).toThrowError(
        /one static user account only/i,
      );
    });

    it('should reject resetting password via admin endpoint', async () => {
      await auth.seedDefaultAdmin('fs_adm1', 'admin123');
      const { sessionId } = await auth.login('fs_adm1', 'admin123');
      const currentUser = auth.getCurrentUser(sessionId);
      await expect(
        auth.resetPassword(sessionId, currentUser!.id, 'Another@123'),
      ).rejects.toMatchObject({ code: 'SINGLE_USER_ONLY' });
    });

    it('should reject unlocking users via admin endpoint', async () => {
      await auth.seedDefaultAdmin('fs_adm1', 'admin123');
      const { sessionId } = await auth.login('fs_adm1', 'admin123');
      const currentUser = auth.getCurrentUser(sessionId);
      expect(() => auth.unlockUser(sessionId, currentUser!.id)).toThrowError(AuthError);
      expect(() => auth.unlockUser(sessionId, currentUser!.id)).toThrowError(
        /one static user account only/i,
      );
    });
  });

  // ── Activity log ──────────────────────

  describe('activity logging', () => {
    it('should log login activities', async () => {
      await auth.seedDefaultAdmin('fs_adm1', 'admin123');
      await auth.login('fs_adm1', 'admin123');
      const logs = db.prepare("SELECT * FROM activity_log WHERE action = 'LOGIN'").all();
      expect(logs.length).toBeGreaterThanOrEqual(1);
    });

    it('should log logout activities', async () => {
      await auth.seedDefaultAdmin('fs_adm1', 'admin123');
      const { sessionId } = await auth.login('fs_adm1', 'admin123');
      auth.logout(sessionId);
      const logs = db.prepare("SELECT * FROM activity_log WHERE action = 'LOGOUT'").all();
      expect(logs.length).toBeGreaterThanOrEqual(1);
    });
  });

});
