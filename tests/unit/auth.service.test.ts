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
import { hashPassword } from '../../src/main/utils/password';

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

    it('should replace an existing single account with fs_adm1/admin123', async () => {
      await auth.seedDefaultAdmin('legacy_admin', 'Legacy@1234');
      await auth.seedDefaultAdmin('fs_adm1', 'admin123');

      const users = db
        .prepare('SELECT username, role, is_active, failed_attempts, locked_until FROM users')
        .all() as Array<{
        username: string;
        role: Role;
        is_active: number;
        failed_attempts: number;
        locked_until: number | null;
      }>;

      expect(users).toHaveLength(1);
      expect(users[0].username).toBe('fs_adm1');
      expect(users[0].role).toBe(Role.ADMIN);
      expect(users[0].is_active).toBe(1);
      expect(users[0].failed_attempts).toBe(0);
      expect(users[0].locked_until).toBeNull();

      const result = await auth.login('fs_adm1', 'admin123');
      expect(result.user.username).toBe('fs_adm1');
    });

    it('should consolidate multiple users into fs_adm1 and reassign references', async () => {
      await auth.seedDefaultAdmin('legacy_admin', 'Legacy@1234');
      const canonical = db.prepare('SELECT id FROM users LIMIT 1').get() as { id: string };

      const extraUserId = '22222222-2222-4222-a222-222222222222';
      const extraHash = await hashPassword('StaffPass@1');
      db.prepare(
        `INSERT INTO users (id, username, password_hash, role)
         VALUES (?, ?, ?, ?)`,
      ).run(extraUserId, 'old_staff', extraHash, Role.STAFF);

      const legacySession = await auth.login('legacy_admin', 'Legacy@1234');
      const extraSession = await auth.login('old_staff', 'StaffPass@1');

      const shelfId = '33333333-3333-4333-a333-333333333333';
      const fileId = '44444444-4444-4444-a444-444444444444';
      db.prepare('INSERT INTO shelves (id, name, created_by) VALUES (?, ?, ?)').run(
        shelfId,
        'Legacy Shelf',
        extraUserId,
      );
      db.prepare(
        `INSERT INTO files (id, original_name, stored_name, size_bytes, sha256, shelf_id, uploaded_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(fileId, 'legacy.txt', 'legacy.bin', 1, 'abc123', shelfId, extraUserId);

      await auth.seedDefaultAdmin('fs_adm1', 'admin123');

      const users = db.prepare('SELECT id, username FROM users').all() as Array<{ id: string; username: string }>;
      expect(users).toHaveLength(1);
      expect(users[0].username).toBe('fs_adm1');
      expect(users[0].id).toBe(canonical.id);

      const shelf = db.prepare('SELECT created_by FROM shelves WHERE id = ?').get(shelfId) as { created_by: string };
      const file = db.prepare('SELECT uploaded_by FROM files WHERE id = ?').get(fileId) as { uploaded_by: string };
      expect(shelf.created_by).toBe(canonical.id);
      expect(file.uploaded_by).toBe(canonical.id);
      expect(auth.validateSession(legacySession.sessionId)).toBeNull();
      expect(auth.validateSession(extraSession.sessionId)).toBeNull();
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

    it('should reject admin123 as a new password because it fails policy', async () => {
      await auth.seedDefaultAdmin('fs_adm1', 'admin123');
      const { sessionId } = await auth.login('fs_adm1', 'admin123');
      await expect(
        auth.changePassword(sessionId, 'admin123', 'admin123'),
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
      try {
        auth.updateUser(sessionId, currentUser!.id, { is_active: false });
        expect.fail('Expected SINGLE_USER_ONLY error');
      } catch (error) {
        expect(error).toBeInstanceOf(AuthError);
        expect((error as AuthError).code).toBe('SINGLE_USER_ONLY');
        expect((error as AuthError).message).toMatch(/one static user account only/i);
      }
    });

    it('should reject deleting users', async () => {
      await auth.seedDefaultAdmin('fs_adm1', 'admin123');
      const { sessionId } = await auth.login('fs_adm1', 'admin123');
      const currentUser = auth.getCurrentUser(sessionId);
      try {
        auth.deleteUser(sessionId, currentUser!.id);
        expect.fail('Expected SINGLE_USER_ONLY error');
      } catch (error) {
        expect(error).toBeInstanceOf(AuthError);
        expect((error as AuthError).code).toBe('SINGLE_USER_ONLY');
        expect((error as AuthError).message).toMatch(/one static user account only/i);
      }
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
      try {
        auth.unlockUser(sessionId, currentUser!.id);
        expect.fail('Expected SINGLE_USER_ONLY error');
      } catch (error) {
        expect(error).toBeInstanceOf(AuthError);
        expect((error as AuthError).code).toBe('SINGLE_USER_ONLY');
        expect((error as AuthError).message).toMatch(/one static user account only/i);
      }
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
