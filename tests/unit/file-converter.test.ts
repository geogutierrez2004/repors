import { describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';
import { convertDocxToHtml, convertXlsxToHtml } from '../../src/main/utils/file-converter';

vi.mock('mammoth', () => ({
  default: {
    convertToHtml: vi.fn(),
  },
}));

describe('file converter utils', () => {
  it('converts DOCX buffer to HTML', async () => {
    vi.mocked(mammoth.convertToHtml).mockResolvedValueOnce({
      value: '<p>docx</p>',
      messages: [],
    });
    const result = await convertDocxToHtml(Buffer.from('docx'));
    expect(result).toEqual({ ok: true, html: '<p>docx</p>' });
  });

  it('converts XLSX buffer to HTML table', () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([['Name', 'Value'], ['A', 1]]);
    XLSX.utils.book_append_sheet(workbook, sheet, 'Sheet1');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    const result = convertXlsxToHtml(buffer);
    expect(result.ok).toBe(true);
    expect(result.html).toContain('<table');
    expect(result.html).toContain('<th>Name</th>');
    expect(result.html).toContain('<td>1</td>');
  });
});
