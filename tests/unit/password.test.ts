/**
 * Unit tests for password utility functions.
 */
import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, validatePasswordPolicy } from '../../src/main/utils/password';

describe('hashPassword / verifyPassword', () => {
  it('should hash and verify a password correctly', async () => {
    const password = 'SecurePass@123';
    const hash = await hashPassword(password);

    expect(hash).toBeDefined();
    expect(hash).not.toBe(password);

    const isValid = await verifyPassword(hash, password);
    expect(isValid).toBe(true);
  });

  it('should reject an incorrect password', async () => {
    const hash = await hashPassword('CorrectPassword@1');
    const isValid = await verifyPassword(hash, 'WrongPassword@1');
    expect(isValid).toBe(false);
  });

  it('should produce different hashes for the same password (salted)', async () => {
    const password = 'SamePassword@1';
    const hash1 = await hashPassword(password);
    const hash2 = await hashPassword(password);
    expect(hash1).not.toBe(hash2);
  });
});

describe('validatePasswordPolicy', () => {
  it('should accept a valid password', () => {
    const result = validatePasswordPolicy('Str0ng!Pass');
    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('should reject a password that is too short', () => {
    const result = validatePasswordPolicy('Ab1!');
    expect(result.valid).toBe(false);
    expect(result.violations).toContain('Password must be at least 8 characters');
  });

  it('should reject a password without uppercase', () => {
    const result = validatePasswordPolicy('lowercase1!');
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.includes('uppercase'))).toBe(true);
  });

  it('should reject a password without lowercase', () => {
    const result = validatePasswordPolicy('UPPERCASE1!');
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.includes('lowercase'))).toBe(true);
  });

  it('should reject a password without a digit', () => {
    const result = validatePasswordPolicy('NoDigits!Here');
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.includes('digit'))).toBe(true);
  });

  it('should reject a password without a special character', () => {
    const result = validatePasswordPolicy('NoSpecial1Here');
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.includes('special'))).toBe(true);
  });

  it('should reject a password that is too long', () => {
    const longPassword = 'A'.repeat(129) + 'a1!';
    const result = validatePasswordPolicy(longPassword);
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.includes('at most'))).toBe(true);
  });

  it('should collect multiple violations', () => {
    const result = validatePasswordPolicy('abc');
    expect(result.valid).toBe(false);
    expect(result.violations.length).toBeGreaterThanOrEqual(3);
  });
});
