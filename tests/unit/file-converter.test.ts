import { describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';
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

  it('converts XLSX buffer to HTML table', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sheet1');
    sheet.addRow(['Name', 'Value']);
    sheet.addRow(['A', 1]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const result = await convertXlsxToHtml(buffer);
    expect(result.ok).toBe(true);
    expect(result.html).toContain('<table');
    expect(result.html).toContain('<th>Name</th>');
    expect(result.html).toContain('<td>1</td>');
  });
});
