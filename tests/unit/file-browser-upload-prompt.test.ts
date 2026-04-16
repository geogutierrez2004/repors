import { describe, expect, it, vi } from 'vitest';
import { requestUploadEncryptionDecision } from '../../src/renderer/pages/FileBrowser';

describe('FileBrowser upload encryption prompt', () => {
  it('asks encryption question before upload decision and returns encrypted choice', () => {
    const confirmMock = vi.fn().mockReturnValue(true);
    const decision = requestUploadEncryptionDecision(confirmMock);

    expect(confirmMock).toHaveBeenCalledWith('Encrypt this file before uploading?');
    expect(decision).toBe(true);
  });

  it('returns non-encrypted choice when encryption is declined', () => {
    const confirmMock = vi.fn().mockReturnValue(false);
    const decision = requestUploadEncryptionDecision(confirmMock);

    expect(confirmMock).toHaveBeenCalledWith('Encrypt this file before uploading?');
    expect(decision).toBe(false);
  });
});
