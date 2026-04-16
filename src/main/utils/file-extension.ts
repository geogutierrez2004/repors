export function normalizeExtension(ext: string | null | undefined): string | null {
  if (!ext) return null;
  const clean = ext.trim().toLowerCase();
  if (!clean || clean === '.') return null;
  return clean.startsWith('.') ? clean : `.${clean}`;
}

export function guessExtensionFromMime(mimeType: string | null): string | null {
  if (!mimeType) return null;
  const map: Record<string, string> = {
    'application/pdf': '.pdf',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/vnd.ms-excel': '.xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'text/plain': '.txt',
    'text/csv': '.csv',
    'application/zip': '.zip',
  };
  return map[mimeType.toLowerCase()] ?? null;
}
