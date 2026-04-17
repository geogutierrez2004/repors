import mammoth from 'mammoth';
import ExcelJS from 'exceljs';

export type PreviewKind = 'pdf' | 'image' | 'text' | 'audio' | 'video' | 'docx' | 'xlsx' | 'fallback';

export function inferMimeFromFileName(fileName: string): string | null {
  const lowerName = fileName.toLowerCase();
  if (lowerName.endsWith('.pdf')) return 'application/pdf';
  if (lowerName.endsWith('.png')) return 'image/png';
  if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) return 'image/jpeg';
  if (lowerName.endsWith('.gif')) return 'image/gif';
  if (lowerName.endsWith('.webp')) return 'image/webp';
  if (lowerName.endsWith('.bmp')) return 'image/bmp';
  if (lowerName.endsWith('.svg')) return 'image/svg+xml';
  if (lowerName.endsWith('.mp3')) return 'audio/mpeg';
  if (lowerName.endsWith('.wav')) return 'audio/wav';
  if (lowerName.endsWith('.ogg')) return 'audio/ogg';
  if (lowerName.endsWith('.m4a')) return 'audio/mp4';
  if (lowerName.endsWith('.mp4')) return 'video/mp4';
  if (lowerName.endsWith('.webm')) return 'video/webm';
  if (lowerName.endsWith('.mov')) return 'video/quicktime';
  if (lowerName.endsWith('.txt')) return 'text/plain';
  if (lowerName.endsWith('.md')) return 'text/markdown';
  if (lowerName.endsWith('.csv')) return 'text/csv';
  if (lowerName.endsWith('.json')) return 'application/json';
  if (lowerName.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (lowerName.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  return null;
}

export function getPreviewKind(mimeType: string | null, fileName: string): PreviewKind {
  const mime = (mimeType ?? inferMimeFromFileName(fileName) ?? '').toLowerCase();
  const lowerName = fileName.toLowerCase();
  if (
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    || lowerName.endsWith('.docx')
  ) {
    return 'docx';
  }
  if (
    mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    || lowerName.endsWith('.xlsx')
  ) {
    return 'xlsx';
  }
  if (mime === 'application/pdf' || lowerName.endsWith('.pdf')) return 'pdf';
  if (
    mime.startsWith('image/')
    || lowerName.endsWith('.png')
    || lowerName.endsWith('.jpg')
    || lowerName.endsWith('.jpeg')
    || lowerName.endsWith('.gif')
    || lowerName.endsWith('.webp')
    || lowerName.endsWith('.bmp')
    || lowerName.endsWith('.svg')
  ) {
    return 'image';
  }
  if (
    mime.startsWith('audio/')
    || lowerName.endsWith('.mp3')
    || lowerName.endsWith('.wav')
    || lowerName.endsWith('.ogg')
    || lowerName.endsWith('.m4a')
  ) {
    return 'audio';
  }
  if (
    mime.startsWith('video/')
    || lowerName.endsWith('.mp4')
    || lowerName.endsWith('.webm')
    || lowerName.endsWith('.mov')
  ) {
    return 'video';
  }
  if (
    mime.startsWith('text/')
    || lowerName.endsWith('.txt')
    || lowerName.endsWith('.md')
    || lowerName.endsWith('.csv')
    || lowerName.endsWith('.json')
    || lowerName.endsWith('.xml')
    || lowerName.endsWith('.log')
  ) {
    return 'text';
  }
  return 'fallback';
}

export function decodeBase64ToBytes(contentBase64: string): Uint8Array {
  const binary = atob(contentBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function escapeHtml(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&#39;');
}

export async function convertDocxBase64ToHtml(contentBase64: string): Promise<string> {
  const bytes = decodeBase64ToBytes(contentBase64);
  const result = await mammoth.convertToHtml({ arrayBuffer: toArrayBuffer(bytes) });
  const hasConversionError = result.messages?.some((message) => message.type === 'error');
  if (hasConversionError) {
    const details = result.messages
      .filter((message) => message.type === 'error')
      .map((message) => message.message)
      .join('; ');
    throw new Error(details || 'DOCX conversion failed');
  }
  return result.value ?? '';
}

export async function convertXlsxBase64ToHtml(contentBase64: string): Promise<string> {
  const bytes = decodeBase64ToBytes(contentBase64);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(toArrayBuffer(bytes));

  if (workbook.worksheets.length === 0) {
    return '<p>No worksheets found in this workbook.</p>';
  }

  const sections = workbook.worksheets.map((worksheet) => {
    const sheetName = worksheet.name || 'Sheet';
    const rows: string[] = [];
    if (worksheet.rowCount === 0) {
      rows.push('<tr><td></td></tr>');
    } else {
      for (let rowIndex = 1; rowIndex <= worksheet.rowCount; rowIndex += 1) {
        const row = worksheet.getRow(rowIndex);
        const cellCount = Math.max(row.cellCount, 1);
        const cells: string[] = [];
        for (let cellIndex = 1; cellIndex <= cellCount; cellIndex += 1) {
          const cell = row.getCell(cellIndex);
          cells.push(`<td>${escapeHtml(cell.text)}</td>`);
        }
        rows.push(`<tr>${cells.join('')}</tr>`);
      }
    }
    return `<section><h4>${escapeHtml(sheetName)}</h4><table><tbody>${rows.join('')}</tbody></table></section>`;
  }).join('');

  return sections;
}

export async function convertPreviewToHtml(previewKind: PreviewKind, contentBase64: string): Promise<string | null> {
  if (previewKind === 'docx') {
    return convertDocxBase64ToHtml(contentBase64);
  }
  if (previewKind === 'xlsx') {
    return convertXlsxBase64ToHtml(contentBase64);
  }
  return null;
}
