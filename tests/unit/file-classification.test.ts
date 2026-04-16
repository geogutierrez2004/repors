import { describe, expect, it } from 'vitest';
import { classifyFile } from '../../src/main/utils/file-classification';

describe('classifyFile', () => {
  it('classifies native preview files', () => {
    expect(classifyFile('a.pdf', 'application/pdf').category).toBe('native');
    expect(classifyFile('a.png', 'image/png').renderer).toBe('image');
    expect(classifyFile('a.txt', 'text/plain').renderer).toBe('text');
    expect(classifyFile('a.html', 'text/html').renderer).toBe('html');
  });

  it('classifies convertible preview files', () => {
    expect(classifyFile('a.docx', null)).toMatchObject({
      category: 'convertible',
      converter: 'docx-to-html',
      renderingTier: 2,
    });
    expect(classifyFile('a.xlsx', null)).toMatchObject({
      category: 'convertible',
      converter: 'xlsx-to-html',
      renderingTier: 2,
    });
  });

  it('classifies unsupported files', () => {
    expect(classifyFile('a.zip', 'application/zip')).toMatchObject({
      category: 'unsupported',
      renderingTier: 3,
      renderer: 'download',
    });
  });
});
