import { describe, expect, it, vi } from 'vitest';
import {
  requestUploadEncryptionDecision,
  validateEncryptionPasswords,
} from '../../src/renderer/pages/FileBrowser';

describe('FileBrowser upload encryption prompt', () => {
  it('asks encryption question before upload decision and returns yes/no/cancel', () => {
    const promptMock = vi.fn().mockReturnValue('yes');
    const decision = requestUploadEncryptionDecision(promptMock);

    expect(promptMock).toHaveBeenCalledWith('Encrypt this file before uploading?');
    expect(decision).toBe('yes');
  });

  it('validates password entry when encrypt is selected', () => {
    expect(validateEncryptionPasswords('', '')).toBe('Encryption password is required.');
    expect(validateEncryptionPasswords('abc', 'xyz')).toBe('Encryption passwords do not match.');
    expect(validateEncryptionPasswords('same', 'same')).toBeNull();
  });

  it('returns cancel when user aborts upload choice', () => {
    const promptMock = vi.fn().mockReturnValue('cancel');
    expect(requestUploadEncryptionDecision(promptMock)).toBe('cancel');
  });
});
