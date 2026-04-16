import mammoth from 'mammoth';
import ExcelJS from 'exceljs';

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

export async function convertXlsxToHtml(buffer: Buffer): Promise<ConverterResult> {
  try {
    const workbook = new ExcelJS.Workbook();
    const data = Uint8Array.from(buffer).buffer;
    await workbook.xlsx.load(data);
    const firstSheet = workbook.worksheets[0];
    if (!firstSheet) {
      return { ok: false, error: 'Workbook has no sheets' };
    }
    const rows: Array<Array<string | number | boolean | null>> = [];
    firstSheet.eachRow({ includeEmpty: false }, (row) => {
      const values = (row.values as Array<string | number | boolean | null | undefined>).slice(1);
      rows.push(values.map((cell) => cell ?? null));
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
