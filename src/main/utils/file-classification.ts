import path from 'node:path';
import type { FileClassification } from '../../shared/types';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);
const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.csv', '.json']);
const HTML_EXTENSIONS = new Set(['.html', '.htm']);

export function classifyFile(fileName: string, mimeType: string | null): FileClassification {
  const ext = path.extname(fileName).toLowerCase();
  const normalizedMime = (mimeType ?? '').toLowerCase();

  if (normalizedMime === 'application/pdf' || ext === '.pdf') {
    return {
      category: 'native',
      renderingTier: 1,
      fileType: 'pdf',
      renderer: 'pdf',
      converter: null,
      mimeType: mimeType ?? 'application/pdf',
    };
  }

  if (normalizedMime.startsWith('image/') || IMAGE_EXTENSIONS.has(ext)) {
    return {
      category: 'native',
      renderingTier: 1,
      fileType: 'image',
      renderer: 'image',
      converter: null,
      mimeType: mimeType ?? 'image/*',
    };
  }

  if (normalizedMime === 'text/html' || HTML_EXTENSIONS.has(ext)) {
    return {
      category: 'native',
      renderingTier: 1,
      fileType: 'html',
      renderer: 'html',
      converter: null,
      mimeType: mimeType ?? 'text/html',
    };
  }

  if (
    normalizedMime.startsWith('text/')
    || normalizedMime === 'application/json'
    || TEXT_EXTENSIONS.has(ext)
  ) {
    return {
      category: 'native',
      renderingTier: 1,
      fileType: 'text',
      renderer: 'text',
      converter: null,
      mimeType: mimeType ?? 'text/plain',
    };
  }

  if (
    normalizedMime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    || ext === '.docx'
  ) {
    return {
      category: 'convertible',
      renderingTier: 2,
      fileType: 'docx',
      renderer: 'html',
      converter: 'docx-to-html',
      mimeType: mimeType ?? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
  }

  if (
    normalizedMime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    || ext === '.xlsx'
  ) {
    return {
      category: 'convertible',
      renderingTier: 2,
      fileType: 'xlsx',
      renderer: 'html',
      converter: 'xlsx-to-html',
      mimeType: mimeType ?? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }

  return {
    category: 'unsupported',
    renderingTier: 3,
    fileType: 'unknown',
    renderer: 'download',
    converter: null,
    mimeType,
  };
}
