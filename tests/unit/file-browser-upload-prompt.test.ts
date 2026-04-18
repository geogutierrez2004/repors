import { describe, expect, it } from 'vitest';
import {
  validateEncryptionPasswords,
} from '../../src/renderer/pages/FileBrowser';

describe('FileBrowser upload encryption prompt', () => {
  it('validates password entry for mandatory encrypted upload', () => {
    expect(validateEncryptionPasswords('', '')).toBe('Encryption password is required.');
    expect(validateEncryptionPasswords('abc', 'xyz')).toBe('Encryption passwords do not match.');
    expect(validateEncryptionPasswords('same', 'same')).toBeNull();
  });
});
