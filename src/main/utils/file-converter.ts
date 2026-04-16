import mammoth from 'mammoth';
import * as XLSX from 'xlsx';

export interface ConverterResult {
  ok: boolean;
  html?: string;
  error?: string;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export async function convertDocxToHtml(buffer: Buffer): Promise<ConverterResult> {
  try {
    const result = await mammoth.convertToHtml({ buffer });
    return { ok: true, html: result.value };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'DOCX conversion failed',
    };
  }
}

export function convertXlsxToHtml(buffer: Buffer): ConverterResult {
  try {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) {
      return { ok: false, error: 'Workbook has no sheets' };
    }
    const sheet = workbook.Sheets[firstSheetName];
    const rows = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(sheet, {
      header: 1,
      blankrows: false,
    });

    const htmlRows = rows.map((row, rowIndex) => {
      const cells = row.map((cell) => {
        const tag = rowIndex === 0 ? 'th' : 'td';
        return `<${tag}>${escapeHtml(cell)}</${tag}>`;
      }).join('');
      return `<tr>${cells}</tr>`;
    }).join('');

    const html = `<div><table border="1" cellspacing="0" cellpadding="6"><tbody>${htmlRows}</tbody></table></div>`;
    return { ok: true, html };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'XLSX conversion failed',
    };
  }
}
