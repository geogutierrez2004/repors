import mammoth from 'mammoth';
import readXlsxFile from 'read-excel-file/universal';

export type PreviewKind = 'pdf' | 'image' | 'text' | 'audio' | 'video' | 'docx' | 'xlsx' | 'doc' | 'xls' | 'fallback';

/**
 * Returns true for any preview kind that goes through the HTML conversion pipeline
 * (mammoth or read-excel-file) rather than native browser rendering.
 */
export function isConvertedKind(kind: PreviewKind): boolean {
  return kind === 'docx' || kind === 'doc' || kind === 'xlsx' || kind === 'xls';
}

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
  if (lowerName.endsWith('.doc')) return 'application/msword';
  if (lowerName.endsWith('.xls')) return 'application/vnd.ms-excel';
  if (lowerName.endsWith('.ppt')) return 'application/vnd.ms-powerpoint';
  if (lowerName.endsWith('.pptx')) return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
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
  if (mime === 'application/msword' || lowerName.endsWith('.doc')) {
    return 'doc';
  }
  if (mime === 'application/vnd.ms-excel' || lowerName.endsWith('.xls')) {
    return 'xls';
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
  const errors = result.messages?.filter((message) => message.type === 'error') ?? [];
  if (errors.length > 0) {
    const details = errors.map((message) => message.message).join('; ');
    throw new Error(details ? `DOCX conversion failed: ${details}` : 'DOCX conversion failed');
  }
  return result.value ?? '';
}

/**
 * Attempt to convert a legacy .doc file using mammoth.
 * Works for XML-based .doc files (e.g. Word 2003 XML or .docx renamed to .doc).
 * Throws for true binary Word 97–2003 documents; callers show a clear fallback message.
 */
export async function convertDocBase64ToHtml(contentBase64: string): Promise<string> {
  const bytes = decodeBase64ToBytes(contentBase64);
  const result = await mammoth.convertToHtml({ arrayBuffer: toArrayBuffer(bytes) });
  const errors = result.messages?.filter((message) => message.type === 'error') ?? [];
  if (errors.length > 0) {
    const details = errors.map((message) => message.message).join('; ');
    throw new Error(details ? `DOC conversion failed: ${details}` : 'DOC conversion failed');
  }
  return result.value ?? '';
}

export async function convertXlsxBase64ToHtml(contentBase64: string): Promise<string> {
  const bytes = decodeBase64ToBytes(contentBase64);
  const arrayBuffer = toArrayBuffer(bytes);
  const sheets = await readXlsxFile(arrayBuffer);

  if (sheets.length === 0) {
    return '<p>No worksheets found in this workbook.</p>';
  }

  const sectionList: string[] = [];
  for (const sheet of sheets) {
    const sheetName = sheet.sheet;
    const values = sheet.data;
    const rows = values.length > 0
      ? values.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
      : ['<tr><td></td></tr>'];
    sectionList.push(`<section><h4>${escapeHtml(sheetName)}</h4><table><tbody>${rows.join('')}</tbody></table></section>`);
  }

  return sectionList.join('');
}

/**
 * Attempt to convert a legacy .xls file using read-excel-file.
 * read-excel-file targets the XLSX Open XML format; it will throw for true binary
 * Excel 97–2003 (.xls) workbooks.  Callers catch the error and show a clear
 * fallback message.
 */
export async function convertXlsBase64ToHtml(contentBase64: string): Promise<string> {
  return convertXlsxBase64ToHtml(contentBase64);
}

export async function convertPreviewToHtml(previewKind: PreviewKind, contentBase64: string): Promise<string | null> {
  if (previewKind === 'docx') {
    return convertDocxBase64ToHtml(contentBase64);
  }
  if (previewKind === 'doc') {
    return convertDocBase64ToHtml(contentBase64);
  }
  if (previewKind === 'xlsx') {
    return convertXlsxBase64ToHtml(contentBase64);
  }
  if (previewKind === 'xls') {
    return convertXlsBase64ToHtml(contentBase64);
  }
  return null;
}
