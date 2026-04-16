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
import { requirePermission, Permission, RbacError } from './rbac.service';

// ────────────────────────────────────────
// Helpers
// ────────────────────────────────────────

function toSafeUser(u: UserRecord): SafeUser {
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    is_active: !!u.is_active,
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

  private throwSingleUserOnly(): never {
    throw new AuthError(
      'SINGLE_USER_ONLY',
      'This system supports one static user account only',
    );
  }

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

  // ── User CRUD (admin) ───────────────

  async createUser(
    _sessionId: string,
    _username: string,
    _password: string,
    _role: Role,
  ): Promise<SafeUser> {
    this.throwSingleUserOnly();
  }

  listUsers(sessionId: string): SafeUser[] {
    const session = this.requireAuth(sessionId);
    requirePermission(session.role, Permission.USER_LIST);

    const rows = this.db.prepare('SELECT * FROM users ORDER BY username').all() as UserRecord[];
    return rows.map(toSafeUser);
  }

  updateUser(
    _sessionId: string,
    _userId: string,
    _updates: { role?: Role; is_active?: boolean },
  ): SafeUser {
    this.throwSingleUserOnly();
  }

  deleteUser(_sessionId: string, _userId: string): void {
    this.throwSingleUserOnly();
  }

  async resetPassword(_sessionId: string, _userId: string, _newPassword: string): Promise<void> {
    this.throwSingleUserOnly();
  }

  unlockUser(_sessionId: string, _userId: string): SafeUser {
    this.throwSingleUserOnly();
  }

  // ── Seed default admin ───────────────

  async seedDefaultAdmin(username: string, password: string): Promise<void> {
    const users = this.db
      .prepare('SELECT id, username FROM users ORDER BY rowid ASC')
      .all() as Array<{ id: string; username: string }>;
    const hash = await hashPassword(password);

    if (users.length === 0) {
      const id = uuidv4();
      this.db
        .prepare(
          `INSERT INTO users (id, username, password_hash, role)
           VALUES (?, ?, ?, ?)`,
        )
        .run(id, username, hash, Role.ADMIN);
      return;
    }

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
           SET username = ?, password_hash = ?, role = ?, is_active = 1, failed_attempts = 0, locked_until = NULL, updated_at = datetime('now')
           WHERE id = ?`,
        )
        .run(username, hash, Role.ADMIN, canonicalUserId);
    });

    consolidateTransaction();
  }

  // ── Private helpers ──────────────────

  private requireAuth(sessionId: string): Session {
    const session = validateSession(sessionId);
    if (!session) throw new AuthError('INVALID_SESSION', 'Session expired or invalid');
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
}
