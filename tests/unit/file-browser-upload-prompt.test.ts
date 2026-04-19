import { describe, expect, it } from 'vitest';
import {
  extractDroppedFilePaths,
  validateEncryptionPasswords,
} from '../../src/renderer/pages/FileBrowser';

describe('FileBrowser upload encryption prompt', () => {
  it('validates password entry for mandatory encrypted upload', () => {
    expect(validateEncryptionPasswords('', '')).toBe('Encryption password is required.');
    expect(validateEncryptionPasswords('abc', 'xyz')).toBe('Encryption passwords do not match.');
    expect(validateEncryptionPasswords('same', 'same')).toBeNull();
  });

  it('extracts drop file paths from electron file objects', () => {
    const dataTransfer = {
      files: [
        { path: '/tmp/a.pdf' },
        { filePath: '/tmp/b.docx' },
        { name: 'c.txt' },
      ],
    } as unknown as DataTransfer;

    expect(extractDroppedFilePaths(dataTransfer)).toEqual(['/tmp/a.pdf', '/tmp/b.docx']);
  });

  it('trims and deduplicates dropped file paths', () => {
    const dataTransfer = {
      files: [
        { path: '/tmp/a.pdf' },
        { path: '  /tmp/a.pdf  ' },
      ],
    } as unknown as DataTransfer;

    expect(extractDroppedFilePaths(dataTransfer)).toEqual(['/tmp/a.pdf']);
  });

  it('returns empty drop paths when no dataTransfer is provided', () => {
    expect(extractDroppedFilePaths(null)).toEqual([]);
  });
});
