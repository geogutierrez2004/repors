/** Application-wide constants */
export const APP_NAME = 'StClareFilingSystem';

/** Roles in the system. Admin has full access; Staff has limited access. */
export enum Role {
  ADMIN = 'admin',
  STAFF = 'staff',
}

/** Password policy constraints enforced in the main process. */
export const PASSWORD_POLICY = {
  MIN_LENGTH: 8,
  MAX_LENGTH: 128,
  REQUIRE_UPPERCASE: true,
  REQUIRE_LOWERCASE: true,
  REQUIRE_DIGIT: true,
  REQUIRE_SPECIAL: true,
} as const;

/** Authentication and session constants. */
export const AUTH_CONSTANTS = {
  /** Maximum consecutive failed login attempts before lockout. */
  MAX_FAILED_ATTEMPTS: 5,
  /** Lockout duration in milliseconds (15 minutes). */
  LOCKOUT_DURATION_MS: 15 * 60 * 1000,
  /** Session inactivity timeout in milliseconds (30 minutes). */
  SESSION_INACTIVITY_TIMEOUT_MS: 30 * 60 * 1000,
  /** Absolute session expiration in milliseconds (8 hours). */
  SESSION_ABSOLUTE_EXPIRY_MS: 8 * 60 * 60 * 1000,
} as const;

/** Storage constants. */
export const STORAGE_CONSTANTS = {
  /** Maximum file size in bytes (2 GB). */
  MAX_FILE_SIZE: 2 * 1024 * 1024 * 1024,
  /** Default storage quota in bytes (500 GB). */
  DEFAULT_QUOTA_BYTES: 500 * 1024 * 1024 * 1024,
  /** Initial auto-quota is set to this percentage of currently available disk space. */
  AUTO_QUOTA_PERCENT: 80,
} as const;

/** System shelf names that cannot be deleted. */
export const SYSTEM_SHELVES = ['Inbox', 'Archive'] as const;
