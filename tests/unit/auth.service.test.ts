/**
 * Integration tests for AuthService.
 *
 * Uses an in-memory SQLite database to test the full auth flow.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { up as initialSchema } from '../../src/main/database/migrations/001-initial-schema';
import { AuthService, AuthError } from '../../src/main/services/auth.service';
import { clearAllSessions } from '../../src/main/services/session.service';
import { hashPassword } from '../../src/main/utils/password';
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
      await auth.seedDefaultAdmin('admin', 'Admin@1234');
      const result = await auth.login('admin', 'Admin@1234');
      expect(result.sessionId).toBeDefined();
      expect(result.user.username).toBe('admin');
      expect(result.user.role).toBe(Role.ADMIN);
    });

    it('should not re-seed if users already exist', async () => {
      await auth.seedDefaultAdmin('admin', 'Admin@1234');
      await auth.seedDefaultAdmin('admin2', 'Other@1234');
      const users = db.prepare('SELECT COUNT(*) as cnt FROM users').get() as { cnt: number };
      expect(users.cnt).toBe(1);
    });
  });

  // ── Login edge cases ──────────────────

  describe('login', () => {
    beforeEach(async () => {
      await auth.seedDefaultAdmin('admin', 'Admin@1234');
    });

    it('should reject invalid username', async () => {
      await expect(auth.login('nonexistent', 'Admin@1234')).rejects.toThrow(AuthError);
      await expect(auth.login('nonexistent', 'Admin@1234')).rejects.toMatchObject({
        code: 'INVALID_CREDENTIALS',
      });
    });

    it('should reject invalid password', async () => {
      await expect(auth.login('admin', 'WrongPass@1')).rejects.toThrow(AuthError);
    });

    it('should be case-insensitive for username', async () => {
      const result = await auth.login('Admin', 'Admin@1234');
      expect(result.user.username).toBe('admin');
    });

    it('should lock account after max failed attempts', async () => {
      for (let i = 0; i < AUTH_CONSTANTS.MAX_FAILED_ATTEMPTS; i++) {
        await expect(auth.login('admin', 'WrongPass@1')).rejects.toThrow(AuthError);
      }
      // Next attempt should be locked
      await expect(auth.login('admin', 'Admin@1234')).rejects.toMatchObject({
        code: 'ACCOUNT_LOCKED',
      });
    });

    it('should reject login for disabled account', async () => {
      // Login as admin, then disable the admin account via direct DB
      db.prepare('UPDATE users SET is_active = 0 WHERE username = ?').run('admin');
      await expect(auth.login('admin', 'Admin@1234')).rejects.toMatchObject({
        code: 'ACCOUNT_DISABLED',
      });
    });
  });

  // ── Logout ────────────────────────────

  describe('logout', () => {
    it('should invalidate session after logout', async () => {
      await auth.seedDefaultAdmin('admin', 'Admin@1234');
      const { sessionId } = await auth.login('admin', 'Admin@1234');
      auth.logout(sessionId);
      const session = auth.validateSession(sessionId);
      expect(session).toBeNull();
    });
  });

  // ── Session validation ────────────────

  describe('validateSession', () => {
    it('should validate an active session', async () => {
      await auth.seedDefaultAdmin('admin', 'Admin@1234');
      const { sessionId } = await auth.login('admin', 'Admin@1234');
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
      await auth.seedDefaultAdmin('admin', 'Admin@1234');
      const { sessionId } = await auth.login('admin', 'Admin@1234');
      const user = auth.getCurrentUser(sessionId);
      expect(user).not.toBeNull();
      expect(user!.username).toBe('admin');
    });

    it('should return null for an invalid session', () => {
      expect(auth.getCurrentUser('00000000-0000-4000-a000-000000000000')).toBeNull();
    });
  });

  // ── Change password ───────────────────

  describe('changePassword', () => {
    it('should allow changing password with valid current password', async () => {
      await auth.seedDefaultAdmin('admin', 'Admin@1234');
      const { sessionId } = await auth.login('admin', 'Admin@1234');
      await auth.changePassword(sessionId, 'Admin@1234', 'NewPass@5678');
      // Old password should no longer work
      auth.logout(sessionId);
      await expect(auth.login('admin', 'Admin@1234')).rejects.toThrow(AuthError);
      // New password should work
      const result = await auth.login('admin', 'NewPass@5678');
      expect(result.user.username).toBe('admin');
    });

    it('should reject when current password is wrong', async () => {
      await auth.seedDefaultAdmin('admin', 'Admin@1234');
      const { sessionId } = await auth.login('admin', 'Admin@1234');
      await expect(
        auth.changePassword(sessionId, 'WrongPass@1', 'NewPass@5678'),
      ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    });

    it('should reject when new password fails policy', async () => {
      await auth.seedDefaultAdmin('admin', 'Admin@1234');
      const { sessionId } = await auth.login('admin', 'Admin@1234');
      await expect(
        auth.changePassword(sessionId, 'Admin@1234', 'weak'),
      ).rejects.toMatchObject({ code: 'PASSWORD_POLICY' });
    });
  });

  // ── User CRUD ─────────────────────────

  describe('createUser', () => {
    it('should allow admin to create a new user', async () => {
      await auth.seedDefaultAdmin('admin', 'Admin@1234');
      const { sessionId } = await auth.login('admin', 'Admin@1234');
      const newUser = await auth.createUser(sessionId, 'staff1', 'StaffPass@1', Role.STAFF);
      expect(newUser.username).toBe('staff1');
      expect(newUser.role).toBe(Role.STAFF);
    });

    it('should reject duplicate username', async () => {
      await auth.seedDefaultAdmin('admin', 'Admin@1234');
      const { sessionId } = await auth.login('admin', 'Admin@1234');
      await auth.createUser(sessionId, 'staff1', 'StaffPass@1', Role.STAFF);
      await expect(
        auth.createUser(sessionId, 'staff1', 'StaffPass@2', Role.STAFF),
      ).rejects.toMatchObject({ code: 'USERNAME_EXISTS' });
    });

    it('should reject weak password for new user', async () => {
      await auth.seedDefaultAdmin('admin', 'Admin@1234');
      const { sessionId } = await auth.login('admin', 'Admin@1234');
      await expect(
        auth.createUser(sessionId, 'staff1', 'weak', Role.STAFF),
      ).rejects.toMatchObject({ code: 'PASSWORD_POLICY' });
    });
  });

  describe('listUsers', () => {
    it('should list all users when called by admin', async () => {
      await auth.seedDefaultAdmin('admin', 'Admin@1234');
      const { sessionId } = await auth.login('admin', 'Admin@1234');
      await auth.createUser(sessionId, 'staff1', 'StaffPass@1', Role.STAFF);
      const users = auth.listUsers(sessionId);
      expect(users).toHaveLength(2);
      // Ensure password hashes are not exposed
      for (const user of users) {
        expect(user).not.toHaveProperty('password_hash');
      }
    });
  });

  describe('updateUser', () => {
    it('should update user role', async () => {
      await auth.seedDefaultAdmin('admin', 'Admin@1234');
      const { sessionId } = await auth.login('admin', 'Admin@1234');
      const staff = await auth.createUser(sessionId, 'staff1', 'StaffPass@1', Role.STAFF);
      const updated = auth.updateUser(sessionId, staff.id, { role: Role.ADMIN });
      expect(updated.role).toBe(Role.ADMIN);
    });

    it('should disable a user', async () => {
      await auth.seedDefaultAdmin('admin', 'Admin@1234');
      const { sessionId } = await auth.login('admin', 'Admin@1234');
      const staff = await auth.createUser(sessionId, 'staff1', 'StaffPass@1', Role.STAFF);
      const updated = auth.updateUser(sessionId, staff.id, { is_active: false });
      expect(updated.is_active).toBe(false);
    });
  });

  describe('deleteUser', () => {
    it('should delete a user', async () => {
      await auth.seedDefaultAdmin('admin', 'Admin@1234');
      const { sessionId } = await auth.login('admin', 'Admin@1234');
      const staff = await auth.createUser(sessionId, 'staff1', 'StaffPass@1', Role.STAFF);
      auth.deleteUser(sessionId, staff.id);
      const users = auth.listUsers(sessionId);
      expect(users).toHaveLength(1);
    });

    it('should not allow self-delete', async () => {
      await auth.seedDefaultAdmin('admin', 'Admin@1234');
      const { sessionId } = await auth.login('admin', 'Admin@1234');
      const currentUser = auth.getCurrentUser(sessionId);
      expect(() => auth.deleteUser(sessionId, currentUser!.id)).toThrow(AuthError);
    });
  });

  describe('resetPassword', () => {
    it('should allow admin to reset another user password', async () => {
      await auth.seedDefaultAdmin('admin', 'Admin@1234');
      const { sessionId } = await auth.login('admin', 'Admin@1234');
      const staff = await auth.createUser(sessionId, 'staff1', 'StaffPass@1', Role.STAFF);
      await auth.resetPassword(sessionId, staff.id, 'NewStaff@123');
      // Staff should be able to login with new password
      const loginResult = await auth.login('staff1', 'NewStaff@123');
      expect(loginResult.user.username).toBe('staff1');
    });
  });

  describe('unlockUser', () => {
    it('should unlock a locked user', async () => {
      await auth.seedDefaultAdmin('admin', 'Admin@1234');
      // Lock the admin by failing many times
      for (let i = 0; i < AUTH_CONSTANTS.MAX_FAILED_ATTEMPTS; i++) {
        try { await auth.login('admin', 'wrong'); } catch { /* expected */ }
      }
      // Create another admin to do the unlock
      const id2 = uuidv4();
      const hash = await hashPassword('Admin2@1234');
      db.prepare('INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)').run(id2, 'admin2', hash, Role.ADMIN);

      const { sessionId } = await auth.login('admin2', 'Admin2@1234');
      const adminUser = db.prepare("SELECT * FROM users WHERE username = 'admin'").get() as { id: string };
      const unlocked = auth.unlockUser(sessionId, adminUser.id);
      expect(unlocked.is_active).toBe(true);

      // Original admin should now be able to login
      const loginResult = await auth.login('admin', 'Admin@1234');
      expect(loginResult.user.username).toBe('admin');
    });
  });

  // ── Activity log ──────────────────────

  describe('activity logging', () => {
    it('should log login activities', async () => {
      await auth.seedDefaultAdmin('admin', 'Admin@1234');
      await auth.login('admin', 'Admin@1234');
      const logs = db.prepare("SELECT * FROM activity_log WHERE action = 'LOGIN'").all();
      expect(logs.length).toBeGreaterThanOrEqual(1);
    });

    it('should log logout activities', async () => {
      await auth.seedDefaultAdmin('admin', 'Admin@1234');
      const { sessionId } = await auth.login('admin', 'Admin@1234');
      auth.logout(sessionId);
      const logs = db.prepare("SELECT * FROM activity_log WHERE action = 'LOGOUT'").all();
      expect(logs.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── RBAC enforcement ──────────────────

  describe('RBAC enforcement', () => {
    it('should prevent staff from creating users', async () => {
      await auth.seedDefaultAdmin('admin', 'Admin@1234');
      const adminSession = await auth.login('admin', 'Admin@1234');
      await auth.createUser(adminSession.sessionId, 'staff1', 'StaffPass@1', Role.STAFF);

      const staffSession = await auth.login('staff1', 'StaffPass@1');
      await expect(
        auth.createUser(staffSession.sessionId, 'staff2', 'StaffPass@2', Role.STAFF),
      ).rejects.toThrow();
    });

    it('should prevent staff from listing users', async () => {
      await auth.seedDefaultAdmin('admin', 'Admin@1234');
      const adminSession = await auth.login('admin', 'Admin@1234');
      await auth.createUser(adminSession.sessionId, 'staff1', 'StaffPass@1', Role.STAFF);

      const staffSession = await auth.login('staff1', 'StaffPass@1');
      expect(() => auth.listUsers(staffSession.sessionId)).toThrow();
    });

    it('should prevent staff from deleting users', async () => {
      await auth.seedDefaultAdmin('admin', 'Admin@1234');
      const adminSession = await auth.login('admin', 'Admin@1234');
      const staff = await auth.createUser(adminSession.sessionId, 'staff1', 'StaffPass@1', Role.STAFF);

      const staffSession = await auth.login('staff1', 'StaffPass@1');
      expect(() => auth.deleteUser(staffSession.sessionId, staff.id)).toThrow();
    });
  });
});
