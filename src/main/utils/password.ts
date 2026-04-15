/**
 * Password hashing and validation utilities.
 *
 * Uses Argon2id for password hashing (spec §4.1).
 * Falls back to Node.js crypto scrypt if argon2 is unavailable.
 */
import { PASSWORD_POLICY } from '../../shared/constants';

// Try to load argon2; fall back to scrypt-based hashing
let argon2Module: typeof import('argon2') | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  argon2Module = require('argon2');
} catch {
  argon2Module = null;
}

import crypto from 'node:crypto';

// ────────────────────────────────────────
// Argon2id implementation
// ────────────────────────────────────────
async function hashWithArgon2(password: string): Promise<string> {
  if (!argon2Module) throw new Error('argon2 not available');
  return argon2Module.hash(password, {
    type: argon2Module.argon2id,
    memoryCost: 65536, // 64 MB
    timeCost: 3,
    parallelism: 4,
  });
}

async function verifyWithArgon2(hash: string, password: string): Promise<boolean> {
  if (!argon2Module) throw new Error('argon2 not available');
  return argon2Module.verify(hash, password);
}

// ────────────────────────────────────────
// Scrypt fallback implementation
// ────────────────────────────────────────
const SCRYPT_KEYLEN = 64;
const SCRYPT_COST = 32768; // N
const SCRYPT_BLOCK_SIZE = 8; // r
const SCRYPT_PARALLELISM = 1; // p

function scryptHash(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(32);
    crypto.scrypt(
      password,
      salt,
      SCRYPT_KEYLEN,
      { N: SCRYPT_COST, r: SCRYPT_BLOCK_SIZE, p: SCRYPT_PARALLELISM },
      (err, derivedKey) => {
        if (err) return reject(err);
        resolve(`scrypt:${salt.toString('hex')}:${derivedKey.toString('hex')}`);
      },
    );
  });
}

function scryptVerify(hash: string, password: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const parts = hash.split(':');
    if (parts.length !== 3 || parts[0] !== 'scrypt') return resolve(false);
    const salt = Buffer.from(parts[1], 'hex');
    const expected = Buffer.from(parts[2], 'hex');
    crypto.scrypt(
      password,
      salt,
      SCRYPT_KEYLEN,
      { N: SCRYPT_COST, r: SCRYPT_BLOCK_SIZE, p: SCRYPT_PARALLELISM },
      (err, derivedKey) => {
        if (err) return reject(err);
        resolve(crypto.timingSafeEqual(derivedKey, expected));
      },
    );
  });
}

// ────────────────────────────────────────
// Exported API (auto-selects best available)
// ────────────────────────────────────────

/** Hash a plaintext password. */
export async function hashPassword(password: string): Promise<string> {
  if (argon2Module) return hashWithArgon2(password);
  return scryptHash(password);
}

/** Verify a plaintext password against a stored hash. */
export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  if (hash.startsWith('scrypt:')) return scryptVerify(hash, password);
  if (argon2Module) return verifyWithArgon2(hash, password);
  return false;
}

/** Whether argon2 native module is available. */
export function isArgon2Available(): boolean {
  return argon2Module !== null;
}

// ────────────────────────────────────────
// Password policy validation
// ────────────────────────────────────────

export interface PasswordPolicyResult {
  valid: boolean;
  violations: string[];
}

/** Validate a password against the configured policy. */
export function validatePasswordPolicy(password: string): PasswordPolicyResult {
  const violations: string[] = [];

  if (password.length < PASSWORD_POLICY.MIN_LENGTH) {
    violations.push(`Password must be at least ${PASSWORD_POLICY.MIN_LENGTH} characters`);
  }
  if (password.length > PASSWORD_POLICY.MAX_LENGTH) {
    violations.push(`Password must be at most ${PASSWORD_POLICY.MAX_LENGTH} characters`);
  }
  if (PASSWORD_POLICY.REQUIRE_UPPERCASE && !/[A-Z]/.test(password)) {
    violations.push('Password must contain at least one uppercase letter');
  }
  if (PASSWORD_POLICY.REQUIRE_LOWERCASE && !/[a-z]/.test(password)) {
    violations.push('Password must contain at least one lowercase letter');
  }
  if (PASSWORD_POLICY.REQUIRE_DIGIT && !/\d/.test(password)) {
    violations.push('Password must contain at least one digit');
  }
  if (PASSWORD_POLICY.REQUIRE_SPECIAL && !/[^A-Za-z0-9]/.test(password)) {
    violations.push('Password must contain at least one special character');
  }

  return { valid: violations.length === 0, violations };
}
