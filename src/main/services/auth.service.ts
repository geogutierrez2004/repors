/**
 * Authentication service.
 *
 * Handles login, logout, password changes, user CRUD, and
 * account lockout logic (spec §4.1).
 *
 * All DB access runs in the main process only.
 */
import { v4 as uuidv4 } from 'uuid';
import type Database from 'better-sqlite3';
import { AUTH_CONSTANTS, Role } from '../../shared/constants';
import type {
  UserRecord,
  SafeUser,
  LoginResponse,
  Session,
} from '../../shared/types';
import { hashPassword, verifyPassword, validatePasswordPolicy } from '../utils/password';
import { createSession, validateSession, destroySession, destroyUserSessions } from './session.service';

const ANONYMOUS_UPLOAD_USER_ID = '00000000-0000-4000-a000-000000000010';

// ────────────────────────────────────────
// Helpers
// ────────────────────────────────────────

function toSafeUser(u: UserRecord): SafeUser {
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    is_active: !!u.is_active,
    locked_until: u.locked_until,
    created_at: u.created_at,
    updated_at: u.updated_at,
  };
}

/** Service-level error with a machine-readable code. */
export class AuthError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

// ────────────────────────────────────────
// Auth service class
// ────────────────────────────────────────

export class AuthService {
  constructor(private db: Database.Database) {}

  // ── Login ────────────────────────────

  async login(username: string, password: string): Promise<LoginResponse> {
    const row = this.db
      .prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE')
      .get(username) as UserRecord | undefined;

    if (!row) {
      throw new AuthError('INVALID_CREDENTIALS', 'Invalid username or password');
    }

    // Check lockout
    if (row.locked_until && Date.now() < row.locked_until) {
      throw new AuthError(
        'ACCOUNT_LOCKED',
        `Account is locked. Try again after ${new Date(row.locked_until).toISOString()}`,
      );
    }

    // Check active
    if (!row.is_active) {
      throw new AuthError('ACCOUNT_DISABLED', 'Account is disabled');
    }

    // Verify password
    const valid = await verifyPassword(row.password_hash, password);
    if (!valid) {
      this.recordFailedAttempt(row);
      throw new AuthError('INVALID_CREDENTIALS', 'Invalid username or password');
    }

    // Reset failed attempts on success
    this.db
      .prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL, updated_at = datetime(\'now\') WHERE id = ?')
      .run(row.id);

    const session = createSession(row.id, row.role as Role);
    this.logActivity(row.id, 'LOGIN', `User ${row.username} logged in`);

    return {
      sessionId: session.sessionId,
      user: toSafeUser({ ...row, failed_attempts: 0, locked_until: null }),
    };
  }

  // ── Logout ───────────────────────────

  logout(sessionId: string): void {
    const session = validateSession(sessionId);
    if (session) {
      this.logActivity(session.userId, 'LOGOUT', 'User logged out');
    }
    destroySession(sessionId);
  }

  // ── Session validation ───────────────

  validateSession(sessionId: string): Session | null {
    return validateSession(sessionId);
  }

  // ── Get current user ─────────────────

  getCurrentUser(sessionId: string): SafeUser | null {
    const session = validateSession(sessionId);
    if (!session) return null;
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(session.userId) as
      | UserRecord
      | undefined;
    return row ? toSafeUser(row) : null;
  }

  // ── Change password ──────────────────

  async changePassword(
    sessionId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const session = validateSession(sessionId);
    if (!session) throw new AuthError('INVALID_SESSION', 'Session expired or invalid');

    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(session.userId) as
      | UserRecord
      | undefined;
    if (!row) throw new AuthError('USER_NOT_FOUND', 'User not found');

    const valid = await verifyPassword(row.password_hash, currentPassword);
    if (!valid) throw new AuthError('INVALID_CREDENTIALS', 'Current password is incorrect');

    const policy = validatePasswordPolicy(newPassword);
    if (!policy.valid) {
      throw new AuthError('PASSWORD_POLICY', policy.violations.join('; '));
    }

    const newHash = await hashPassword(newPassword);
    this.db
      .prepare('UPDATE users SET password_hash = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(newHash, row.id);

    this.logActivity(row.id, 'CHANGE_PASSWORD', 'Password changed');
  }

  // ── User CRUD (admin only) ─────────

  async createUser(
    sessionId: string,
    username: string,
    password: string,
    role: Role,
  ): Promise<SafeUser> {
    this.requireAdmin(sessionId);

    const existing = this.db
      .prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE')
      .get(username) as { id: string } | undefined;
    if (existing) {
      throw new AuthError('USERNAME_EXISTS', 'Username already exists');
    }

    const policy = validatePasswordPolicy(password);
    if (!policy.valid) {
      throw new AuthError('PASSWORD_POLICY', policy.violations.join('; '));
    }

    const hash = await hashPassword(password);
    const id = uuidv4();
    this.db
      .prepare(
        `INSERT INTO users (id, username, password_hash, role, is_active)
         VALUES (?, ?, ?, ?, 1)`,
      )
      .run(id, username, hash, role);

    const newUser = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRecord;
    this.logActivity(newUser.id, 'USER_CREATED', `User ${username} created with role ${role}`);

    return toSafeUser(newUser);
  }

  listUsers(sessionId: string): SafeUser[] {
    this.requireAuth(sessionId);

    const rows = this.db
      .prepare('SELECT * FROM users WHERE id != ? ORDER BY username')
      .all(ANONYMOUS_UPLOAD_USER_ID) as UserRecord[];
    return rows.map(toSafeUser);
  }

  updateUser(
    sessionId: string,
    userId: string,
    updates: { role?: Role; is_active?: boolean },
  ): SafeUser {
    this.requireAdmin(sessionId);

    const user = this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as
      | UserRecord
      | undefined;
    if (!user) {
      throw new AuthError('USER_NOT_FOUND', 'User not found');
    }

    const setClauses: string[] = [];
    const values: (string | number)[] = [];

    if (updates.role !== undefined) {
      setClauses.push('role = ?');
      values.push(updates.role);
    }
    if (updates.is_active !== undefined) {
      setClauses.push('is_active = ?');
      values.push(updates.is_active ? 1 : 0);
    }

    setClauses.push('updated_at = datetime(\'now\')');
    values.push(userId);

    this.db
      .prepare(`UPDATE users SET ${setClauses.join(', ')} WHERE id = ?`)
      .run(...values);

    const updated = this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRecord;
    this.logActivity(updated.id, 'USER_UPDATED', `User ${user.username} updated`);

    if (updates.is_active === false) {
      destroyUserSessions(userId);
    }

    return toSafeUser(updated);
  }

  deleteUser(sessionId: string, userId: string): void {
    this.requireAdmin(sessionId);

    const user = this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as
      | UserRecord
      | undefined;
    if (!user) {
      throw new AuthError('USER_NOT_FOUND', 'User not found');
    }

    // Prevent deletion of admin accounts
    if (user.role === Role.ADMIN) {
      throw new AuthError('PROTECTED_ADMIN', 'Cannot delete admin accounts');
    }

    this.db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    this.logActivity(userId, 'USER_DELETED', `User ${user.username} deleted`);
    destroyUserSessions(userId);
  }

  async resetPassword(sessionId: string, userId: string, newPassword: string): Promise<void> {
    this.requireAdmin(sessionId);

    const user = this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as
      | UserRecord
      | undefined;
    if (!user) {
      throw new AuthError('USER_NOT_FOUND', 'User not found');
    }

    const policy = validatePasswordPolicy(newPassword);
    if (!policy.valid) {
      throw new AuthError('PASSWORD_POLICY', policy.violations.join('; '));
    }

    const hash = await hashPassword(newPassword);
    this.db
      .prepare('UPDATE users SET password_hash = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(hash, userId);

    this.logActivity(userId, 'PASSWORD_RESET', `Password reset for ${user.username}`);
    destroyUserSessions(userId);
  }

  unlockUser(sessionId: string, userId: string): SafeUser {
    this.requireAdmin(sessionId);

    const user = this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as
      | UserRecord
      | undefined;
    if (!user) {
      throw new AuthError('USER_NOT_FOUND', 'User not found');
    }

    this.db
      .prepare(
        'UPDATE users SET failed_attempts = 0, locked_until = NULL, updated_at = datetime(\'now\') WHERE id = ?',
      )
      .run(userId);

    this.logActivity(userId, 'USER_UNLOCKED', `User ${user.username} unlocked`);

    const updated = this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRecord;
    return toSafeUser(updated);
  }

  // ── Seed default admin ───────────────

  async seedDefaultAdmin(username: string, password: string): Promise<void> {
    // Check if seeding has already been done
    const appState = this.db
      .prepare('SELECT seeding_complete FROM _app_state WHERE id = ?')
      .get('app') as { seeding_complete: number } | undefined;

    if (appState?.seeding_complete === 1) {
      // Seeding already completed; skip to avoid deleting user accounts
      return;
    }

    const users = this.db
      .prepare('SELECT id, username FROM users WHERE id != ? ORDER BY rowid ASC')
      .all(ANONYMOUS_UPLOAD_USER_ID) as Array<{ id: string; username: string }>;
    const hash = await hashPassword(password);

    if (users.length === 0) {
      const id = uuidv4();
      this.db
        .prepare(
          `INSERT INTO users (id, username, password_hash, role)
           VALUES (?, ?, ?, ?)`,
        )
        .run(id, username, hash, Role.ADMIN);
    } else {
      const preferredUser =
        users.find((u) => u.username.toLowerCase() === username.toLowerCase()) ?? users[0];
      const canonicalUserId = preferredUser.id;
      const extraUserIds = users.filter((u) => u.id !== canonicalUserId).map((u) => u.id);

      const consolidateTransaction = this.db.transaction(() => {
        if (extraUserIds.length > 0) {
          const placeholders = extraUserIds.map(() => '?').join(', ');

          this.db
            .prepare(`UPDATE shelves SET created_by = ? WHERE created_by IN (${placeholders})`)
            .run(canonicalUserId, ...extraUserIds);
          this.db
            .prepare(`UPDATE files SET uploaded_by = ? WHERE uploaded_by IN (${placeholders})`)
            .run(canonicalUserId, ...extraUserIds);
          this.db
            .prepare(`UPDATE upload_history SET user_id = ? WHERE user_id IN (${placeholders})`)
            .run(canonicalUserId, ...extraUserIds);
          this.db
            .prepare(`UPDATE downloads SET user_id = ? WHERE user_id IN (${placeholders})`)
            .run(canonicalUserId, ...extraUserIds);
          this.db
            .prepare(`UPDATE activity_log SET user_id = ? WHERE user_id IN (${placeholders})`)
            .run(canonicalUserId, ...extraUserIds);

          this.db.prepare(`DELETE FROM users WHERE id IN (${placeholders})`).run(...extraUserIds);
        }

        this.db
          .prepare(
            `UPDATE users
             SET username = ?, password_hash = ?, role = ?, is_active = 1, failed_attempts = 0, locked_until = NULL, updated_at = datetime('now', 'utc')
             WHERE id = ?`,
          )
          .run(username, hash, Role.ADMIN, canonicalUserId);
      });

      consolidateTransaction();
      destroyUserSessions(canonicalUserId);
      for (const userId of extraUserIds) {
        destroyUserSessions(userId);
      }
    }

    // Mark seeding as complete
    this.db.prepare('UPDATE _app_state SET seeding_complete = 1 WHERE id = ?').run('app');
  }

  // ── Private helpers ──────────────────

  private requireAuth(sessionId: string): Session {
    const session = validateSession(sessionId);
    if (!session) throw new AuthError('INVALID_SESSION', 'Session expired or invalid');
    return session;
  }

  private requireAdmin(sessionId: string): Session {
    const session = this.requireAuth(sessionId);
    if (session.role !== Role.ADMIN) {
      throw new AuthError('FORBIDDEN', 'Only administrators can perform this action');
    }
    return session;
  }

  private recordFailedAttempt(user: UserRecord): void {
    const newAttempts = user.failed_attempts + 1;
    const lockedUntil =
      newAttempts >= AUTH_CONSTANTS.MAX_FAILED_ATTEMPTS
        ? Date.now() + AUTH_CONSTANTS.LOCKOUT_DURATION_MS
        : null;

    this.db
      .prepare(
        'UPDATE users SET failed_attempts = ?, locked_until = ?, updated_at = datetime(\'now\') WHERE id = ?',
      )
      .run(newAttempts, lockedUntil, user.id);

    if (lockedUntil) {
      this.logActivity(user.id, 'ACCOUNT_LOCKED', `Account locked after ${newAttempts} failed attempts`);
    }
  }

  private logActivity(userId: string, action: string, detail: string): void {
    this.db
      .prepare('INSERT INTO activity_log (id, user_id, action, detail) VALUES (?, ?, ?, ?)')
      .run(uuidv4(), userId, action, detail);
  }

  /**
   * Public method to log audit events for user actions (uploads, deletions, backups).
   * Stores structured audit data in activity_log with optional JSON details.
   */
  logAudit(userId: string, action: string, target: string, details?: Record<string, unknown>): void {
    // For file operations, only show the human-readable target (filename), not technical details
    const fileOperations = ['FILE_MOVE', 'FILE_RENAME', 'FILE_DELETE', 'FILE_DOWNLOAD', 'FILE_VIEW', 'FILE_UPLOAD', 'BACKUP_CREATE', 'BACKUP_RESTORE'];
    const detailStr = fileOperations.includes(action) ? target : (details ? `${target}: ${JSON.stringify(details)}` : target);
    this.logActivity(userId, action, detailStr);
  }
}
