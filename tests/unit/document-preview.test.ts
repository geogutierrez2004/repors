import { beforeEach, describe, expect, it, vi } from 'vitest';
import mammoth from 'mammoth';
import readXlsxFile from 'read-excel-file/universal';
import {
  inferMimeFromFileName,
  getPreviewKind,
  convertDocxBase64ToHtml,
  convertPreviewToHtml,
  convertXlsxBase64ToHtml,
} from '../../src/renderer/utils/document-preview';

vi.mock('mammoth', () => ({
  default: {
    convertToHtml: vi.fn(),
  },
}));

vi.mock('read-excel-file/universal', () => ({
  default: vi.fn(),
}));

describe('document preview utilities', () => {
  beforeEach(() => {
    vi.mocked(mammoth.convertToHtml).mockReset();
    vi.mocked(readXlsxFile).mockReset();
  });

  it('classifies docx/xlsx previews from MIME and extension', () => {
    expect(getPreviewKind('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'file.bin')).toBe('docx');
    expect(getPreviewKind(null, 'report.docx')).toBe('docx');
    expect(inferMimeFromFileName('report.docx')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');

    expect(getPreviewKind('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'file.bin')).toBe('xlsx');
    expect(getPreviewKind(null, 'grades.xlsx')).toBe('xlsx');
    expect(inferMimeFromFileName('grades.xlsx')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  });

  it('converts DOCX base64 to HTML', async () => {
    vi.mocked(mammoth.convertToHtml).mockResolvedValue({
      value: '<p>Hello DOCX</p>',
      messages: [],
    });

    const base64 = Buffer.from('fake-docx').toString('base64');
    const html = await convertDocxBase64ToHtml(base64);

    expect(html).toBe('<p>Hello DOCX</p>');
    expect(mammoth.convertToHtml).toHaveBeenCalledTimes(1);
    expect(mammoth.convertToHtml).toHaveBeenCalledWith(expect.objectContaining({ arrayBuffer: expect.any(ArrayBuffer) }));
  });

  it('converts XLSX base64 to HTML tables', async () => {
    vi.mocked(readXlsxFile).mockResolvedValue([
      {
        sheet: 'Grades',
        data: [
          ['Student', 'Score'],
          ['Ana', 95],
        ],
      },
    ]);
    const base64 = Buffer.from('fake-xlsx').toString('base64');
    const html = await convertXlsxBase64ToHtml(base64);

    expect(html).toContain('<table>');
    expect(html).toContain('Grades');
    expect(html).toContain('Ana');
    expect(html).toContain('95');
    expect(readXlsxFile).toHaveBeenCalledTimes(1);
  });

  it('escapes special characters in XLSX cell values', async () => {
    vi.mocked(readXlsxFile).mockResolvedValue([
      {
        sheet: 'Unsafe',
        data: [['<script>alert(1)</script>', '&', '"quote"', '\'single\'']],
      },
    ]);
    const base64 = Buffer.from('fake-xlsx-unsafe').toString('base64');
    const html = await convertXlsxBase64ToHtml(base64);

    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&amp;');
    expect(html).toContain('&quot;quote&quot;');
    expect(html).toContain('&#39;single&#39;');
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it('falls back for unsupported previews', () => {
    expect(getPreviewKind('application/vnd.openxmlformats-officedocument.presentationml.presentation', 'slides.pptx')).toBe('fallback');
    expect(getPreviewKind('application/msword', 'legacy.doc')).toBe('fallback');
    expect(getPreviewKind('application/vnd.ms-excel', 'legacy.xls')).toBe('fallback');
  });

  it('propagates conversion errors and allows fallback for unsupported kinds', async () => {
    vi.mocked(mammoth.convertToHtml).mockRejectedValue(new Error('DOCX conversion failed'));
    const base64 = Buffer.from('broken-docx').toString('base64');

    await expect(convertPreviewToHtml('docx', base64)).rejects.toThrow('DOCX conversion failed');
    await expect(convertPreviewToHtml('fallback', base64)).resolves.toBeNull();
  });
});
