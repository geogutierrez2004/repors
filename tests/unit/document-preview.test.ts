import { beforeEach, describe, expect, it, vi } from 'vitest';
import mammoth from 'mammoth';
import readXlsxFile from 'read-excel-file/universal';
import {
  inferMimeFromFileName,
  getPreviewKind,
  isConvertedKind,
  convertDocxBase64ToHtml,
  convertDocBase64ToHtml,
  convertPreviewToHtml,
  convertXlsxBase64ToHtml,
  convertXlsBase64ToHtml,
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

  it('classifies doc/xls previews from MIME and extension', () => {
    expect(getPreviewKind('application/msword', 'file.bin')).toBe('doc');
    expect(getPreviewKind(null, 'report.doc')).toBe('doc');
    expect(inferMimeFromFileName('report.doc')).toBe('application/msword');

    expect(getPreviewKind('application/vnd.ms-excel', 'file.bin')).toBe('xls');
    expect(getPreviewKind(null, 'grades.xls')).toBe('xls');
    expect(inferMimeFromFileName('grades.xls')).toBe('application/vnd.ms-excel');
  });

  it('classifies ppt/pptx and unknown as fallback', () => {
    expect(getPreviewKind('application/vnd.ms-powerpoint', 'slides.ppt')).toBe('fallback');
    expect(getPreviewKind(null, 'slides.ppt')).toBe('fallback');
    expect(inferMimeFromFileName('slides.ppt')).toBe('application/vnd.ms-powerpoint');

    expect(getPreviewKind('application/vnd.openxmlformats-officedocument.presentationml.presentation', 'slides.pptx')).toBe('fallback');
    expect(getPreviewKind(null, 'slides.pptx')).toBe('fallback');
    expect(inferMimeFromFileName('slides.pptx')).toBe('application/vnd.openxmlformats-officedocument.presentationml.presentation');

    expect(getPreviewKind('application/octet-stream', 'unknown.bin')).toBe('fallback');
    expect(getPreviewKind(null, 'unknown.bin')).toBe('fallback');
  });

  it('identifies converted kinds correctly', () => {
    expect(isConvertedKind('docx')).toBe(true);
    expect(isConvertedKind('doc')).toBe(true);
    expect(isConvertedKind('xlsx')).toBe(true);
    expect(isConvertedKind('xls')).toBe(true);
    expect(isConvertedKind('pdf')).toBe(false);
    expect(isConvertedKind('image')).toBe(false);
    expect(isConvertedKind('fallback')).toBe(false);
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

  it('converts DOC base64 to HTML via mammoth (XML-based .doc success path)', async () => {
    vi.mocked(mammoth.convertToHtml).mockResolvedValue({
      value: '<p>Hello DOC</p>',
      messages: [],
    });

    const base64 = Buffer.from('fake-doc').toString('base64');
    const html = await convertDocBase64ToHtml(base64);

    expect(html).toBe('<p>Hello DOC</p>');
    expect(mammoth.convertToHtml).toHaveBeenCalledTimes(1);
  });

  it('propagates DOC conversion errors (binary .doc legacy format)', async () => {
    vi.mocked(mammoth.convertToHtml).mockRejectedValue(new Error('Could not find file in options'));
    const base64 = Buffer.from('binary-doc').toString('base64');
    await expect(convertDocBase64ToHtml(base64)).rejects.toThrow('Could not find file in options');
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

  it('converts XLS base64 to HTML tables (xlsx-compatible .xls success path)', async () => {
    vi.mocked(readXlsxFile).mockResolvedValue([
      {
        sheet: 'Summary',
        data: [['Col A', 'Col B'], ['val1', 'val2']],
      },
    ]);
    const base64 = Buffer.from('fake-xls').toString('base64');
    const html = await convertXlsBase64ToHtml(base64);

    expect(html).toContain('Summary');
    expect(html).toContain('val1');
    expect(readXlsxFile).toHaveBeenCalledTimes(1);
  });

  it('propagates XLS conversion errors (binary .xls legacy format)', async () => {
    vi.mocked(readXlsxFile).mockRejectedValue(new Error('Not an XLSX file'));
    const base64 = Buffer.from('binary-xls').toString('base64');
    await expect(convertXlsBase64ToHtml(base64)).rejects.toThrow('Not an XLSX file');
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

  it('propagates conversion errors and returns null for unsupported/fallback kinds', async () => {
    vi.mocked(mammoth.convertToHtml).mockRejectedValue(new Error('DOCX conversion failed'));
    const base64 = Buffer.from('broken-docx').toString('base64');

    await expect(convertPreviewToHtml('docx', base64)).rejects.toThrow('DOCX conversion failed');
    await expect(convertPreviewToHtml('fallback', base64)).resolves.toBeNull();
    await expect(convertPreviewToHtml('pdf', base64)).resolves.toBeNull();
  });

  it('convertPreviewToHtml routes doc and xls through conversion pipeline', async () => {
    vi.mocked(mammoth.convertToHtml).mockResolvedValue({ value: '<p>doc</p>', messages: [] });
    vi.mocked(readXlsxFile).mockResolvedValue([{ sheet: 'S', data: [] }]);

    const docBase64 = Buffer.from('doc-content').toString('base64');
    const xlsBase64 = Buffer.from('xls-content').toString('base64');

    const docResult = await convertPreviewToHtml('doc', docBase64);
    expect(docResult).toContain('doc');
    expect(mammoth.convertToHtml).toHaveBeenCalledTimes(1);

    const xlsResult = await convertPreviewToHtml('xls', xlsBase64);
    expect(xlsResult).not.toBeNull();
    expect(readXlsxFile).toHaveBeenCalledTimes(1);
  });
});
