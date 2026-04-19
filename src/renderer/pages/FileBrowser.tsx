/**
 * File Browser page.
 *
 * Paginated, searchable, filterable file table. Supports upload (file input + drag/drop),
 * download, move to folder, and delete. Folder filter shown in a left column. Selection
 * supports bulk operations.
 */
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import createDOMPurify from 'dompurify';
import type {
  FileRecord,
  ShelfRecord,
  PaginatedResult,
  SourceHandlingMode,
  StagedUploadFile,
} from '../../shared/types';
import type { AddToast } from '../App';
import type { SafeUser } from '../../shared/types';
import { cardStyle, btnStyle } from '../App';
import {
  type PreviewKind,
  inferMimeFromFileName,
  getPreviewKind,
  decodeBase64ToBytes,
  convertPreviewToHtml,
  isConvertedKind,
} from '../utils/document-preview';

interface Props {
  sessionId: string;
  user: SafeUser;
  addToast: AddToast;
}

const PAGE_SIZE = 25;
const PREVIEW_MODAL_DEFAULT_WIDTH = 900;
const PREVIEW_MODAL_DEFAULT_HEIGHT = 720;
const PREVIEW_MODAL_MIN_WIDTH = 420;
const PREVIEW_MODAL_MIN_HEIGHT = 360;
const PREVIEW_MODAL_VIEWPORT_MARGIN = 24;

export function validateEncryptionPasswords(password: string, confirmPassword: string): string | null {
  if (!password.trim()) return 'Encryption password is required.';
  if (password !== confirmPassword) return 'Encryption passwords do not match.';
  return null;
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Unexpected file reader result.'));
        return;
      }
      const base64 = result.includes(',') ? result.split(',')[1] ?? '' : result;
      resolve(base64);
    };
    reader.readAsDataURL(file);
  });
}

function fmtBytes(b: number): string {
  if (b >= 1e9) return `${(b / 1e9).toFixed(2)} GB`;
  if (b >= 1e6) return `${(b / 1e6).toFixed(1)} MB`;
  if (b >= 1e3) return `${(b / 1e3).toFixed(0)} KB`;
  return `${b} B`;
}

function fmtDate(ts: string): string {
  return new Date(ts).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
}

// ────────────────────────────────────────
// Move-to-folder modal
// ────────────────────────────────────────

function MoveModal({
  shelves,
  onConfirm,
  onCancel,
}: {
  shelves: ShelfRecord[];
  onConfirm: (shelfId: string) => void;
  onCancel: () => void;
}) {
  const [selected, setSelected] = useState(shelves[0]?.id ?? '');
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div style={{ ...cardStyle(), width: 360 }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16, color: 'var(--text-primary)' }}>
          Move to Folder
        </h3>
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          style={{
            width: '100%',
            padding: '8px 10px',
            borderRadius: 6,
            border: '1px solid var(--border)',
            background: 'var(--bg-surface)',
            color: 'var(--text-primary)',
            fontSize: 13,
            marginBottom: 16,
          }}
        >
          {shelves.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={btnStyle('secondary', true)}>
            Cancel
          </button>
          <button onClick={() => onConfirm(selected)} style={btnStyle('primary', true)}>
            Move
          </button>
        </div>
      </div>
    </div>
  );
}

function OverlayModal({
  children,
  modalStyle,
}: {
  children: React.ReactNode;
  modalStyle?: React.CSSProperties;
}) {
  const modal = (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1100,
      }}
    >
      <div
        style={{ ...cardStyle(), width: 460, maxWidth: '92vw', position: 'relative', ...modalStyle }}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

// ────────────────────────────────────────
// Main component
// ────────────────────────────────────────

export function FileBrowser({ sessionId, user, addToast }: Props): React.JSX.Element {
  const pdfCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const uploadPasswordRef = useRef<HTMLInputElement | null>(null);
  const uploadPasswordConfirmRef = useRef<HTMLInputElement | null>(null);
  const decryptionPasswordRef = useRef<HTMLInputElement | null>(null);

  const [shelves, setShelves] = useState<ShelfRecord[]>([]);
  const [files, setFiles] = useState<PaginatedResult<FileRecord>>({
    items: [],
    total: 0,
    page: 1,
    pageSize: PAGE_SIZE,
  });
  const [selectedShelf, setSelectedShelf] = useState<string | undefined>();
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [sourceHandlingMode, setSourceHandlingMode] = useState<SourceHandlingMode>('ask_each_time');
  const [moveModal, setMoveModal] = useState<string[] | null>(null);
  const [newShelfName, setNewShelfName] = useState('');
  const [addingShelf, setAddingShelf] = useState(false);
  const [showSourceHandlingModal, setShowSourceHandlingModal] = useState(false);
  const [sourceHandlingModalResolve, setSourceHandlingModalResolve] = useState<((mode: SourceHandlingMode | null) => void) | null>(null);
  const [showUploadPasswordModal, setShowUploadPasswordModal] = useState(false);
  const [stagedUploadFile, setStagedUploadFile] = useState<StagedUploadFile | null>(null);
  const [pendingUploadMode, setPendingUploadMode] = useState<SourceHandlingMode>('keep_original');
  const [uploadPasswordError, setUploadPasswordError] = useState<string | null>(null);
  const [isDragOverUploadZone, setIsDragOverUploadZone] = useState(false);
  const dragDepthRef = useRef(0);
  const [decryptPrompt, setDecryptPrompt] = useState<{ fileId: string; name: string; mode: 'download' | 'view' } | null>(null);
  const [decryptionPassword, setDecryptionPassword] = useState('');
  const [decryptionError, setDecryptionError] = useState<string | null>(null);
  const [viewer, setViewer] = useState<{
    viewId: string;
    fileName: string;
    mimeType: string | null;
    contentBase64: string;
    cleanupAfterMs: number;
  } | null>(null);
  const [convertedHtml, setConvertedHtml] = useState<string | null>(null);
  const [conversionLoading, setConversionLoading] = useState(false);
  const [conversionError, setConversionError] = useState<string | null>(null);
  const [pdfPage, setPdfPage] = useState(1);
  const [pdfTotalPages, setPdfTotalPages] = useState(1);
  const [embeddedLinkUrl, setEmbeddedLinkUrl] = useState<string | null>(null);
  const [previewModalSize, setPreviewModalSize] = useState({
    width: PREVIEW_MODAL_DEFAULT_WIDTH,
    height: PREVIEW_MODAL_DEFAULT_HEIGHT,
  });
  const resizeStartRef = useRef<{
    mouseX: number;
    mouseY: number;
    width: number;
    height: number;
  } | null>(null);
  const [isResizingPreview, setIsResizingPreview] = useState(false);

  const clampPreviewSize = useCallback((width: number, height: number) => {
    const maxWidth = Math.max(
      PREVIEW_MODAL_MIN_WIDTH,
      window.innerWidth - PREVIEW_MODAL_VIEWPORT_MARGIN,
    );
    const maxHeight = Math.max(
      PREVIEW_MODAL_MIN_HEIGHT,
      window.innerHeight - PREVIEW_MODAL_VIEWPORT_MARGIN,
    );
    return {
      width: Math.min(maxWidth, Math.max(PREVIEW_MODAL_MIN_WIDTH, Math.round(width))),
      height: Math.min(maxHeight, Math.max(PREVIEW_MODAL_MIN_HEIGHT, Math.round(height))),
    };
  }, []);

  const loadShelves = useCallback(async () => {
    const res = await window.sccfs.shelves.list(sessionId);
    if (res.ok) setShelves(res.data);
  }, [sessionId]);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    const res = await window.sccfs.files.list(sessionId, {
      shelfId: selectedShelf,
      search: search || undefined,
      page,
      pageSize: PAGE_SIZE,
    });
    if (res.ok) setFiles(res.data);
    else addToast('error', res.error?.message ?? 'Failed to load files');
    setLoading(false);
  }, [sessionId, selectedShelf, search, page, addToast]);

  useEffect(() => {
    loadShelves();
  }, [loadShelves]);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  // Deselect on page/filter change
  useEffect(() => {
    setSelected(new Set());
  }, [page, selectedShelf, search]);

  const previewKind = useMemo(
    () => (viewer ? getPreviewKind(viewer.mimeType, viewer.fileName) : 'fallback'),
    [viewer],
  );
  const conversionSettled = isConvertedKind(previewKind) && !conversionLoading && !conversionError;
  const viewerDataUrl = useMemo(() => {
    if (!viewer) return '';
    const mime = viewer.mimeType ?? inferMimeFromFileName(viewer.fileName) ?? 'application/octet-stream';
    return `data:${mime};base64,${viewer.contentBase64}`;
  }, [viewer]);
  const viewerTextContent = useMemo(() => {
    if (!viewer || previewKind !== 'text') return '';
    return new TextDecoder().decode(decodeBase64ToBytes(viewer.contentBase64));
  }, [viewer?.contentBase64, previewKind, viewer]);
  useEffect(() => {
    if (!viewer || !isConvertedKind(previewKind)) {
      setConvertedHtml(null);
      setConversionLoading(false);
      setConversionError(null);
      return;
    }

    let cancelled = false;
    const convert = async () => {
      setConversionLoading(true);
      setConvertedHtml(null);
      setConversionError(null);
      try {
        const rawHtml = await convertPreviewToHtml(previewKind, viewer.contentBase64);
        if (!rawHtml || cancelled) {
          if (!cancelled) {
            setConvertedHtml(null);
            setConversionError('Unable to convert this document for preview. Please use Download to access the file.');
          }
          return;
        }
        const purifier = createDOMPurify(window);
        const safeHtml = purifier.sanitize(rawHtml, { USE_PROFILES: { html: true } });
        if (cancelled) return;
        setConvertedHtml(safeHtml);
      } catch (error) {
        console.error('Secure document conversion failed', error);
        if (cancelled) return;
        setConversionError('Unable to convert this document for preview. Please use Download to access the file.');
      } finally {
        if (!cancelled) {
          setConversionLoading(false);
        }
      }
    };
    void convert();
    return () => {
      cancelled = true;
    };
  }, [viewer, previewKind]);

  useEffect(() => {
    if (!viewer || previewKind !== 'pdf') {
      setPdfPage(1);
      setPdfTotalPages(1);
      return;
    }
    setPdfPage(1);
  }, [viewer, previewKind]);

  useEffect(() => {
    setEmbeddedLinkUrl(null);
  }, [viewer, previewKind]);

  useEffect(() => {
    if (!viewer) return;
    setPreviewModalSize(clampPreviewSize(PREVIEW_MODAL_DEFAULT_WIDTH, PREVIEW_MODAL_DEFAULT_HEIGHT));
  }, [viewer, clampPreviewSize]);

  useEffect(() => {
    if (!viewer) return;
    const onResize = () => {
      setPreviewModalSize((prev) => clampPreviewSize(prev.width, prev.height));
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
    };
  }, [viewer, clampPreviewSize]);

  useEffect(() => {
    if (!isResizingPreview) return;

    const onMouseMove = (event: MouseEvent) => {
      const start = resizeStartRef.current;
      if (!start) return;
      const deltaX = event.clientX - start.mouseX;
      const deltaY = event.clientY - start.mouseY;
      setPreviewModalSize(clampPreviewSize(start.width + deltaX, start.height + deltaY));
    };

    const onMouseUp = () => {
      resizeStartRef.current = null;
      setIsResizingPreview(false);
    };

    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'nwse-resize';

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    return () => {
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [isResizingPreview, clampPreviewSize]);

  useEffect(() => {
    if (!viewer || previewKind !== 'pdf' || !pdfCanvasRef.current) return;
    let cancelled = false;
    const render = async () => {
      try {
        const pdfModule = await import('pdfjs-dist/legacy/build/pdf.mjs').catch(
          async () => import('pdfjs-dist/build/pdf.mjs'),
        );
        const { getDocument, GlobalWorkerOptions } = pdfModule;
        if (!GlobalWorkerOptions.workerSrc) {
          GlobalWorkerOptions.workerSrc = './pdf.worker.mjs';
        }
        const bytes = decodeBase64ToBytes(viewer.contentBase64);
        const doc = await getDocument({ data: bytes, disableWorker: true }).promise;
        if (cancelled) return;

        if (!doc.numPages || doc.numPages < 1) {
          throw new Error('The PDF has no readable pages.');
        }

        setPdfTotalPages(doc.numPages);
        const currentPage = Math.min(Math.max(1, pdfPage), doc.numPages);
        if (currentPage !== pdfPage) {
          setPdfPage(currentPage);
          return;
        }

        const pdfPageData = await doc.getPage(currentPage);
        const viewport = pdfPageData.getViewport({ scale: 1.25 });
        const canvas = pdfCanvasRef.current;
        if (!canvas || cancelled) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await pdfPageData.render({ canvasContext: ctx, viewport }).promise;
      } catch (error) {
        console.error('PDF preview render failed', error);
        const message = error instanceof Error ? error.message : 'Unknown PDF error';
        addToast('error', `Unable to render PDF preview: ${message}`);
      }
    };
    void render();
    return () => {
      cancelled = true;
    };
  }, [viewer, previewKind, pdfPage, addToast]);

  useEffect(() => {
    if (!showUploadPasswordModal) return;
    const timer = window.setTimeout(() => {
      uploadPasswordRef.current?.focus();
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [showUploadPasswordModal]);

  useEffect(() => {
    if (!decryptPrompt) return;
    const timer = window.setTimeout(() => {
      decryptionPasswordRef.current?.focus();
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [decryptPrompt]);

  const resetStagedUpload = useCallback(() => {
    setStagedUploadFile(null);
    setUploadPasswordError(null);
    if (uploadPasswordRef.current) uploadPasswordRef.current.value = '';
    if (uploadPasswordConfirmRef.current) uploadPasswordConfirmRef.current.value = '';
  }, []);

  const resolveUploadMode = useCallback(async (): Promise<SourceHandlingMode | null> => {
    return await new Promise<SourceHandlingMode | null>((resolve) => {
      setSourceHandlingModalResolve(() => (mode: SourceHandlingMode | null) => {
        setShowSourceHandlingModal(false);
        resolve(mode);
      });
      setShowSourceHandlingModal(true);
    });
  }, []);

  const performUpload = useCallback(async (
    stagedFile: StagedUploadFile,
    encrypt: boolean,
    encryptionPassword?: string,
  ) => {
    if (!selectedShelf) return;
    setUploadLoading(true);
    const effectiveMode = pendingUploadMode;
    try {
      const res = await window.sccfs.files.upload(
        sessionId,
        selectedShelf,
        encrypt,
        encryptionPassword,
        effectiveMode,
        false,
        undefined,
        [stagedFile],
      );
      if (res.ok) {
        const successes = res.data.files.filter((f) => f.success);
        const failures = res.data.files.filter((f) => !f.success);
        const removed = successes.filter((f) => f.removed_original).length;
        if (successes.length > 0) {
          addToast(
            'success',
            encrypt
              ? `Encrypted upload complete (${successes.length} file${successes.length > 1 ? 's' : ''})${removed ? `, removed ${removed} original(s)` : ''}`
              : `Standard upload complete (${successes.length} file${successes.length > 1 ? 's' : ''})${removed ? `, removed ${removed} original(s)` : ''}`,
          );
        } else if (res.data.files.length > 0) {
          addToast('warning', 'Upload completed, but no files were successfully uploaded.');
        }
        if (failures.length > 0) {
          addToast(
            'error',
            `${failures.length} file(s) failed: ${failures[0].error?.message ?? 'Upload failed'}`,
          );
        }
        loadFiles();
        loadShelves();
        return;
      }
      if (res.error?.code !== 'CANCELLED') {
        addToast('error', res.error?.message ?? 'Upload failed');
      }
    } finally {
      setUploadLoading(false);
    }
  }, [addToast, loadFiles, loadShelves, pendingUploadMode, selectedShelf, sessionId]);

  // Shared capture pipeline: stage file in memory, then show handling modal, then encryption modal.
  const handleFileSelected = useCallback(async (file: File) => {
    if (!selectedShelf) {
      addToast('warning', 'Select a folder before uploading');
      return;
    }
    if (!file) {
      addToast('warning', 'No files were selected for upload.');
      return;
    }
    try {
      const staged: StagedUploadFile = {
        source_name: file.name || 'unnamed-file',
        mime_type: file.type || null,
        size_bytes: file.size,
        content_base64: await readFileAsBase64(file),
      };
      if (!staged.content_base64) {
        addToast('error', 'Failed to stage selected file.');
        return;
      }
      setStagedUploadFile(staged);
      const mode = await resolveUploadMode();
      if (!mode) {
        resetStagedUpload();
        return;
      }
      setPendingUploadMode(mode);
      setUploadPasswordError(null);
      if (uploadPasswordRef.current) uploadPasswordRef.current.value = '';
      if (uploadPasswordConfirmRef.current) uploadPasswordConfirmRef.current.value = '';
      setShowUploadPasswordModal(true);
    } catch {
      resetStagedUpload();
      addToast('error', 'Failed to stage selected file.');
    }
  }, [addToast, resolveUploadMode, resetStagedUpload, selectedShelf]);

  const handleUploadButtonClick = () => {
    uploadInputRef.current?.click();
  };

  const handleUploadInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    void handleFileSelected(file);
  };

  const handleDragEnterUploadZone = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current += 1;
    setIsDragOverUploadZone(true);
  };

  const handleDragOverUploadZone = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!isDragOverUploadZone) setIsDragOverUploadZone(true);
  };

  const handleDragLeaveUploadZone = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDragOverUploadZone(false);
  };

  const handleDropUploadZone = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = 0;
    setIsDragOverUploadZone(false);
    const droppedFile = event.dataTransfer.files[0];
    if (!droppedFile) {
      addToast('error', 'Dropped files could not be resolved. Please use the Upload button.');
      return;
    }
    await handleFileSelected(droppedFile);
  };

  const handleDownload = async (fileId: string, name: string, encrypted: boolean) => {
    if (encrypted) {
      setDecryptPrompt({ fileId, name, mode: 'download' });
      setDecryptionPassword('');
      setDecryptionError(null);
      return;
    }
    const res = await window.sccfs.files.download(sessionId, fileId);
    if (res.ok) {
      addToast('success', `Downloaded "${name}"`);
    } else if (res.error?.code !== 'CANCELLED') {
      if (res.error?.code === 'DECRYPTION_FAILED_AUTH_TAG') {
        addToast('error', 'File failed integrity check or is corrupted.');
        return;
      }
      addToast('error', res.error?.message ?? 'Download failed');
    }
  };

  const handleViewEncrypted = async (fileId: string, name: string) => {
    setDecryptPrompt({ fileId, name, mode: 'view' });
    setDecryptionPassword('');
    setDecryptionError(null);
  };

  const handleCancelUploadPassword = () => {
    setShowSourceHandlingModal(false);
    setShowUploadPasswordModal(false);
    resetStagedUpload();
    addToast('info', 'Upload cancelled before processing.');
  };

  const handleSubmitUploadPassword = async () => {
    if (!stagedUploadFile) {
      setUploadPasswordError('No file is staged for upload.');
      return;
    }
    const password = uploadPasswordRef.current?.value ?? '';
    const confirmPassword = uploadPasswordConfirmRef.current?.value ?? '';
    const validation = validateEncryptionPasswords(password, confirmPassword);
    if (validation) {
      setUploadPasswordError(validation);
      return;
    }
    setShowUploadPasswordModal(false);
    await performUpload(stagedUploadFile, true, password);
    resetStagedUpload();
  };

  const handleSubmitDecryptionPassword = async () => {
    if (!decryptPrompt) return;
    const password = decryptionPassword.trim();
    if (!password) {
      setDecryptionError('Password is required.');
      return;
    }
    if (decryptPrompt.mode === 'download') {
      const res = await window.sccfs.files.download(sessionId, decryptPrompt.fileId, password);
      if (res.ok) {
        addToast('success', `Decrypted and downloaded "${decryptPrompt.name}"`);
        setDecryptPrompt(null);
        setDecryptionPassword('');
        setDecryptionError(null);
        return;
      }
      if (res.error?.code === 'DECRYPTION_FAILED_AUTH_TAG') {
        addToast('error', 'File failed integrity check or is corrupted.');
      } else if (res.error?.code !== 'CANCELLED') {
        addToast('error', res.error?.message ?? 'Download failed');
      }
      return;
    }

    const res = await window.sccfs.files.viewEncrypted(sessionId, decryptPrompt.fileId, password);
    if (res.ok) {
      setViewer(res.data);
      setDecryptPrompt(null);
      setDecryptionPassword('');
      setDecryptionError(null);
      addToast('success', `In-app secure preview opened for "${decryptPrompt.name}".`);
      return;
    }
    if (res.error?.code === 'DECRYPTION_FAILED_AUTH_TAG') {
      addToast('error', 'File failed integrity check or is corrupted.');
    } else if (res.error?.code !== 'CANCELLED') {
      addToast('error', res.error?.message ?? 'Unable to securely view this file');
    }
  };

  const closeViewer = async () => {
    if (!viewer) return;
    const viewId = viewer.viewId;
    setEmbeddedLinkUrl(null);
    setPdfPage(1);
    setPdfTotalPages(1);
    setViewer(null);
    const cleanupRes = await window.sccfs.files.cleanupEncryptedView(sessionId, viewId);
    if (cleanupRes.ok && cleanupRes.data.deleted) {
      addToast('info', 'Temporary decrypted preview file deleted.');
      return;
    }
    addToast('info', 'Temporary preview file will be removed automatically shortly.');
  };

  const handleDelete = async (ids: string[]) => {
    if (!confirm(`Delete ${ids.length} file(s)? This cannot be undone.`)) return;
    for (const id of ids) {
      const res = await window.sccfs.files.delete(sessionId, id);
      if (!res.ok) {
        addToast('error', res.error?.message ?? 'Delete failed');
        return;
      }
    }
    addToast('success', `Deleted ${ids.length} file(s)`);
    setSelected(new Set());
    loadFiles();
    loadShelves();
  };

  const handleMove = async (shelfId: string) => {
    if (!moveModal) return;
    for (const id of moveModal) {
      const res = await window.sccfs.files.move(sessionId, id, shelfId);
      if (!res.ok) {
        addToast('error', res.error?.message ?? 'Move failed');
        setMoveModal(null);
        return;
      }
    }
    addToast('success', `Moved ${moveModal.length} file(s)`);
    setMoveModal(null);
    setSelected(new Set());
    loadFiles();
    loadShelves();
  };

  const handleCreateShelf = async () => {
    if (!newShelfName.trim()) return;
    const res = await window.sccfs.shelves.create(sessionId, newShelfName.trim());
    if (res.ok) {
      addToast('success', `Folder "${res.data.name}" created`);
      setNewShelfName('');
      setAddingShelf(false);
      loadShelves();
    } else {
      addToast('error', res.error?.message ?? 'Failed to create folder');
    }
  };

  const handleDeleteShelf = async (shelfId: string, name: string) => {
    if (!confirm(`Delete folder "${name}"? Files will be moved to Inbox.`)) return;
    const res = await window.sccfs.shelves.delete(sessionId, shelfId);
    if (res.ok) {
      addToast('success', `Folder "${name}" deleted`);
      if (selectedShelf === shelfId) setSelectedShelf(undefined);
      loadShelves();
      loadFiles();
    } else {
      addToast('error', res.error?.message ?? 'Failed to delete folder');
    }
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === files.items.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(files.items.map((f: FileRecord) => f.id)));
    }
  };

  const totalPages = Math.max(1, Math.ceil(files.total / PAGE_SIZE));

  const selectedIds = [...selected];
  const startPreviewResize = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    resizeStartRef.current = {
      mouseX: event.clientX,
      mouseY: event.clientY,
      width: previewModalSize.width,
      height: previewModalSize.height,
    };
    setIsResizingPreview(true);
  };

  const handleConvertedLinkClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const anchor = target.closest('a');
    if (!(anchor instanceof HTMLAnchorElement)) return;

    event.preventDefault();

    const href = anchor.getAttribute('href') ?? '';
    if (!href) return;

    let parsed: URL;
    try {
      parsed = new URL(href, window.location.href);
    } catch {
      addToast('warning', 'Invalid link in document preview.');
      return;
    }

    const protocol = parsed.protocol.toLowerCase();
    if (protocol !== 'http:' && protocol !== 'https:') {
      addToast('warning', 'Only HTTP/HTTPS links are allowed in preview.');
      return;
    }

    setEmbeddedLinkUrl(parsed.toString());
  };

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Folders sidebar */}
      <div
        style={{
          width: 200,
          minWidth: 200,
          background: 'var(--bg-surface)',
          borderRight: '1px solid var(--border)',
          overflowY: 'auto',
          padding: 12,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: 1,
            color: 'var(--text-secondary)',
            marginBottom: 8,
          }}
        >
          Folders
        </div>
        <button
          onClick={() => { setSelectedShelf(undefined); setPage(1); }}
          style={{
            display: 'block',
            width: '100%',
            textAlign: 'left',
            padding: '7px 10px',
            borderRadius: 6,
            border: 'none',
            background: selectedShelf === undefined ? 'var(--bg-active)' : 'transparent',
            color: selectedShelf === undefined ? 'var(--accent)' : 'var(--text-primary)',
            fontWeight: selectedShelf === undefined ? 600 : 400,
            cursor: 'pointer',
            fontSize: 13,
            marginBottom: 2,
          }}
        >
          All Files
          <span style={{ float: 'right', color: 'var(--text-secondary)', fontWeight: 400 }}>
            {shelves.reduce((s, sh) => s + sh.file_count, 0)}
          </span>
        </button>

        {shelves.map((s) => (
          <div
            key={s.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              borderRadius: 6,
              marginBottom: 2,
              background: selectedShelf === s.id ? 'var(--bg-active)' : 'transparent',
            }}
          >
            <button
              onClick={() => { setSelectedShelf(s.id); setPage(1); }}
              style={{
                flex: 1,
                textAlign: 'left',
                padding: '7px 10px',
                border: 'none',
                background: 'transparent',
                color: selectedShelf === s.id ? 'var(--accent)' : 'var(--text-primary)',
                fontWeight: selectedShelf === s.id ? 600 : 400,
                cursor: 'pointer',
                fontSize: 13,
              }}
            >
              {s.is_system ? '📋 ' : '📁 '}{s.name}
              <span
                style={{
                  display: 'block',
                  fontSize: 10,
                  color: 'var(--text-secondary)',
                  fontWeight: 400,
                  marginTop: 1,
                }}
              >
                {s.file_count} · {fmtBytes(s.total_size_bytes)}
              </span>
            </button>
            {!s.is_system && (
              <button
                onClick={() => handleDeleteShelf(s.id, s.name)}
                title="Delete folder"
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  padding: '4px 6px',
                  fontSize: 12,
                }}
              >
                ×
              </button>
            )}
          </div>
        ))}

        <div style={{ marginTop: 8 }}>
          {addingShelf ? (
            <>
              <input
                autoFocus
                value={newShelfName}
                onChange={(e) => setNewShelfName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreateShelf(); if (e.key === 'Escape') setAddingShelf(false); }}
                placeholder="Folder name"
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  borderRadius: 5,
                  border: '1px solid var(--accent)',
                  fontSize: 12,
                  background: 'var(--bg-surface)',
                  color: 'var(--text-primary)',
                  marginBottom: 4,
                }}
              />
              <div style={{ display: 'flex', gap: 4 }}>
                <button onClick={handleCreateShelf} style={{ ...btnStyle('primary', true), flex: 1 }}>
                  Add
                </button>
                <button onClick={() => setAddingShelf(false)} style={{ ...btnStyle('secondary', true), flex: 1 }}>
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <button
              onClick={() => setAddingShelf(true)}
              style={{
                width: '100%',
                padding: '6px 10px',
                borderRadius: 6,
                border: '1px dashed var(--border)',
                background: 'transparent',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              + New Folder
            </button>
          )}
        </div>
      </div>

      {/* Main area */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          outline: isDragOverUploadZone ? '2px dashed var(--accent)' : '2px dashed transparent',
          outlineOffset: -2,
          background: isDragOverUploadZone ? 'rgba(59, 130, 246, 0.08)' : undefined,
          transition: 'outline-color 120ms ease, background 120ms ease',
        }}
        onDragEnter={handleDragEnterUploadZone}
        onDragOver={handleDragOverUploadZone}
        onDragLeave={handleDragLeaveUploadZone}
        onDrop={(e) => { void handleDropUploadZone(e); }}
      >
        {/* Toolbar */}
        <div
          style={{
            padding: '12px 20px',
            background: 'var(--bg-surface)',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            gap: 10,
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', flex: 1, gap: 8, minWidth: 200 }}>
            <input
              type="text"
              placeholder="Search files…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { setSearch(searchInput); setPage(1); }
              }}
              style={{
                flex: 1,
                padding: '7px 12px',
                borderRadius: 6,
                border: '1px solid var(--border)',
                background: 'var(--bg-surface)',
                color: 'var(--text-primary)',
                fontSize: 13,
              }}
            />
            <button
              onClick={() => { setSearch(searchInput); setPage(1); }}
              style={btnStyle('secondary', true)}
            >
              🔍 Search
            </button>
            {search && (
              <button
                onClick={() => { setSearch(''); setSearchInput(''); setPage(1); }}
                style={btnStyle('ghost', true)}
              >
                ✕ Clear
              </button>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <select
              value={sourceHandlingMode}
              onChange={(e) => setSourceHandlingMode(e.target.value as SourceHandlingMode)}
              style={{
                padding: '7px 10px',
                borderRadius: 6,
                border: '1px solid var(--border)',
                background: 'var(--bg-surface)',
                color: 'var(--text-primary)',
                fontSize: 12,
              }}
              title="Source file handling after upload"
            >
              <option value="keep_original">Keep originals</option>
              <option value="move_to_system">Move originals to system</option>
              <option value="ask_each_time">Ask each time</option>
            </select>
            {selectedIds.length > 0 && (
              <>
                <button
                  onClick={() => setMoveModal(selectedIds)}
                  style={btnStyle('secondary', true)}
                >
                  📂 Move ({selectedIds.length})
                </button>
                <button
                  onClick={() => handleDelete(selectedIds)}
                  style={btnStyle('danger', true)}
                >
                  🗑 Delete ({selectedIds.length})
                </button>
              </>
            )}
            <button
              onClick={handleUploadButtonClick}
              disabled={uploadLoading}
              style={btnStyle('primary', true)}
            >
              {uploadLoading ? '⏳ Uploading…' : '⬆ Upload'}
            </button>
            <input
              ref={uploadInputRef}
              type="file"
              style={{ display: 'none' }}
              onChange={handleUploadInputChange}
            />
          </div>
        </div>
        {sourceHandlingMode !== 'keep_original' && (
          <div
            style={{
              padding: '8px 20px',
              borderBottom: '1px solid var(--border)',
              background: 'rgba(107, 114, 128, 0.08)',
              color: '#6b7280',
              fontSize: 12,
            }}
          >
            Note: originals are only removed after full per-file success; files are sent to recycle bin/trash by default.
          </div>
        )}

        {/* Table */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
          <div style={{ ...cardStyle(), padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th style={thStyle(40)}>
                    <input
                      type="checkbox"
                      checked={files.items.length > 0 && selected.size === files.items.length}
                      onChange={toggleAll}
                    />
                  </th>
                  <th style={thStyle()}>Name</th>
                  <th style={thStyle(100)}>Folder</th>
                  <th style={thStyle(90)}>Size</th>
                  <th style={thStyle(60)}>Enc.</th>
                  <th style={thStyle(130)}>Uploaded</th>
                  <th style={thStyle(120)}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td
                      colSpan={7}
                      style={{ textAlign: 'center', padding: 32, color: 'var(--text-secondary)' }}
                    >
                      Loading…
                    </td>
                  </tr>
                ) : files.items.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      style={{ textAlign: 'center', padding: 32, color: 'var(--text-secondary)' }}
                    >
                      {search ? 'No files match your search' : 'No files in this folder yet'}
                    </td>
                  </tr>
                ) : (
                  files.items.map((f: FileRecord) => (
                    <tr
                      key={f.id}
                      style={{
                        borderBottom: '1px solid var(--border)',
                        background: selected.has(f.id) ? 'var(--bg-active)' : 'transparent',
                      }}
                    >
                      <td style={tdStyle(40)}>
                        <input
                          type="checkbox"
                          checked={selected.has(f.id)}
                          onChange={() => toggleSelect(f.id)}
                        />
                      </td>
                      <td style={tdStyle()}>
                        <div
                          style={{
                            fontWeight: 500,
                            color: 'var(--text-primary)',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            maxWidth: 260,
                          }}
                        >
                          {fileIcon(f.mime_type)} {f.original_name}
                        </div>
                      </td>
                      <td style={tdStyle(100)}>
                        <span
                          style={{
                            fontSize: 11,
                            background: 'var(--bg-hover)',
                            borderRadius: 4,
                            padding: '2px 6px',
                            color: 'var(--text-secondary)',
                          }}
                        >
                          {f.shelf_name}
                        </span>
                      </td>
                      <td style={{ ...tdStyle(90), color: 'var(--text-secondary)' }}>
                        {fmtBytes(f.size_bytes)}
                      </td>
                      <td style={tdStyle(60)}>
                        {f.is_encrypted ? (
                          <span title="Encrypted" style={{ color: '#7c3aed' }}>🔒</span>
                        ) : (
                          <span title="Not encrypted" style={{ color: 'var(--text-secondary)', fontSize: 12 }}>—</span>
                        )}
                      </td>
                      <td style={{ ...tdStyle(130), color: 'var(--text-secondary)', fontSize: 12 }}>
                        {fmtDate(f.created_at)}
                      </td>
                      <td style={tdStyle(120)}>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button
                            onClick={() => handleDownload(f.id, f.original_name, !!f.is_encrypted)}
                            style={btnStyle('ghost', true)}
                            title="Download"
                          >
                            ⬇
                          </button>
                          {f.is_encrypted ? (
                            <button
                              onClick={() => handleViewEncrypted(f.id, f.original_name)}
                              style={btnStyle('ghost', true)}
                              title="View (secure temp file)"
                            >
                              👁
                            </button>
                          ) : null}
                          <button
                            onClick={() => setMoveModal([f.id])}
                            style={btnStyle('ghost', true)}
                            title="Move"
                          >
                            📂
                          </button>
                          <button
                            onClick={() => handleDelete([f.id])}
                            style={{ ...btnStyle('ghost', true), color: 'var(--danger)' }}
                            title="Delete"
                          >
                            🗑
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                gap: 8,
                marginTop: 16,
              }}
            >
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                style={btnStyle('secondary', true)}
              >
                ‹ Prev
              </button>
              <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                Page {page} of {totalPages} ({files.total} files)
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                style={btnStyle('secondary', true)}
              >
                Next ›
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Move modal */}
      {moveModal && (
        <MoveModal
          shelves={shelves}
          onConfirm={handleMove}
          onCancel={() => setMoveModal(null)}
        />
      )}

      {/* Source Handling Modal */}
      {showSourceHandlingModal && (
        <OverlayModal>
          <h3 style={{ marginTop: 0, marginBottom: 12 }}>File Handling After Upload</h3>
          <p style={{ marginTop: 0, marginBottom: 16, color: 'var(--text-secondary)', fontSize: 13 }}>
            Choose how to handle the source file after a successful upload.
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              onClick={() => {
                sourceHandlingModalResolve?.(null);
                setSourceHandlingModalResolve(null);
                setShowSourceHandlingModal(false);
                addToast('info', 'Upload cancelled before encryption.');
              }}
              style={btnStyle('ghost', true)}
            >
              Cancel
            </button>
            <button
              onClick={() => {
                sourceHandlingModalResolve?.('keep_original');
                setSourceHandlingModalResolve(null);
                setShowSourceHandlingModal(false);
              }}
              style={btnStyle('secondary', true)}
            >
              Keep Originals
            </button>
            <button
              onClick={() => {
                sourceHandlingModalResolve?.('move_to_system');
                setSourceHandlingModalResolve(null);
                setShowSourceHandlingModal(false);
              }}
              style={btnStyle('primary', true)}
            >
              Move to System
            </button>
          </div>
        </OverlayModal>
      )}

      {showUploadPasswordModal && (
        <OverlayModal>
          <h3 style={{ marginTop: 0, marginBottom: 12 }}>Set Encryption Password</h3>
          <p style={{ marginTop: 0, marginBottom: 12, color: 'var(--text-secondary)', fontSize: 13 }}>
            Enter and confirm the password to encrypt this upload.
          </p>
          <input
            ref={uploadPasswordRef}
            type="password"
            autoFocus
            onChange={() => { setUploadPasswordError(null); }}
            placeholder="Encryption password"
            style={modalInputStyle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleSubmitUploadPassword();
              }
            }}
          />
          <input
            ref={uploadPasswordConfirmRef}
            type="password"
            onChange={() => { setUploadPasswordError(null); }}
            placeholder="Confirm password"
            style={{ ...modalInputStyle, marginTop: 8 }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleSubmitUploadPassword();
              }
            }}
          />
          {uploadPasswordError && (
            <div style={{ marginTop: 8, color: 'var(--danger)', fontSize: 12 }}>{uploadPasswordError}</div>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <button
              onClick={handleCancelUploadPassword}
              style={btnStyle('secondary', true)}
            >
              Cancel
            </button>
            <button onClick={() => void handleSubmitUploadPassword()} style={btnStyle('primary', true)}>
              Encrypt & Upload
            </button>
          </div>
        </OverlayModal>
      )}
      {decryptPrompt && (
        <OverlayModal>
          <h3 style={{ marginTop: 0, marginBottom: 12 }}>
            {decryptPrompt.mode === 'view' ? 'Password Required for Preview' : 'Password Required for Download'}
          </h3>
          <p style={{ marginTop: 0, marginBottom: 12, color: 'var(--text-secondary)', fontSize: 13 }}>
            Enter the encryption password for "{decryptPrompt.name}".
          </p>
          <input
            ref={decryptionPasswordRef}
            type="password"
            autoFocus
            value={decryptionPassword}
            onChange={(e) => { setDecryptionPassword(e.target.value); setDecryptionError(null); }}
            placeholder="Decryption password"
            style={modalInputStyle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleSubmitDecryptionPassword();
              }
            }}
          />
          {decryptionError && (
            <div style={{ marginTop: 8, color: 'var(--danger)', fontSize: 12 }}>{decryptionError}</div>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <button
              onClick={() => { setDecryptPrompt(null); setDecryptionPassword(''); setDecryptionError(null); }}
              style={btnStyle('secondary', true)}
            >
              Cancel
            </button>
            <button onClick={() => void handleSubmitDecryptionPassword()} style={btnStyle('primary', true)}>
              Continue
            </button>
          </div>
        </OverlayModal>
      )}
      {viewer && (
        <OverlayModal
          modalStyle={{
            width: previewModalSize.width,
            height: previewModalSize.height,
            maxWidth: '92vw',
            maxHeight: '90vh',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
              <h3 style={{ margin: 0 }}>Secure In-App Viewer</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {previewKind === 'pdf' && (
                  <>
                    <button
                      onClick={() => setPdfPage((prev) => Math.max(1, prev - 1))}
                      disabled={pdfPage <= 1}
                      style={btnStyle('secondary', true)}
                    >
                      Prev
                    </button>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)', minWidth: 84, textAlign: 'center' }}>
                      Page {pdfPage}/{pdfTotalPages}
                    </span>
                    <button
                      onClick={() => setPdfPage((prev) => Math.min(pdfTotalPages, prev + 1))}
                      disabled={pdfPage >= pdfTotalPages}
                      style={btnStyle('secondary', true)}
                    >
                      Next
                    </button>
                  </>
                )}
                <button onClick={() => void closeViewer()} style={btnStyle('secondary', true)}>Close</button>
              </div>
            </div>
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-secondary)' }}>{viewer.fileName}</div>
            <div style={{ marginTop: 14, flex: 1, minHeight: 220, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 6, padding: 10 }}>
            {embeddedLinkUrl ? (
              <div style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => setEmbeddedLinkUrl(null)}
                      style={btnStyle('secondary', true)}
                    >
                      Back to Document
                    </button>
                    <button
                      onClick={() => setEmbeddedLinkUrl(null)}
                      style={btnStyle('ghost', true)}
                    >
                      Close Link
                    </button>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {embeddedLinkUrl}
                  </div>
                </div>
                <iframe
                  title="Preview Link"
                  src={embeddedLinkUrl}
                  sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
                  referrerPolicy="no-referrer"
                  style={{ width: '100%', flex: 1, minHeight: 240, border: '1px solid var(--border)', borderRadius: 6, background: '#fff' }}
                />
              </div>
            ) : (
              <>
                {previewKind === 'pdf' && <canvas ref={pdfCanvasRef} style={{ maxWidth: '100%', display: 'block' }} />}
                {previewKind === 'image' && <img alt={viewer.fileName} src={viewerDataUrl} style={{ maxWidth: '100%', maxHeight: '100%' }} />}
                {previewKind === 'text' && <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{viewerTextContent}</pre>}
                {previewKind === 'audio' && <audio controls src={viewerDataUrl} style={{ width: '100%' }} />}
                {previewKind === 'video' && <video controls src={viewerDataUrl} style={{ width: '100%', maxHeight: '100%' }} />}
                {isConvertedKind(previewKind) && conversionLoading && (
                  <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Converting document...</div>
                )}
                {isConvertedKind(previewKind) && conversionError && (
                  <div style={{ color: 'var(--danger)', fontSize: 13 }}>
                    {conversionError}
                  </div>
                )}
                {conversionSettled && convertedHtml && (
                  <div
                    onClick={handleConvertedLinkClick}
                    style={{ fontSize: 13, color: 'var(--text-primary)' }}
                    dangerouslySetInnerHTML={{ __html: convertedHtml }}
                  />
                )}
                {conversionSettled && !convertedHtml && (
                  <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                    This file type is not supported for in-app preview. Please use Download to access the file.
                  </div>
                )}
                {(previewKind === 'fallback') && (
                  <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                    This file type is not supported for in-app preview. Please use Download to access the file.
                  </div>
                )}
              </>
            )}
            </div>
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
              A temporary decrypted copy used for preview is auto-deleted in about {Math.round(viewer.cleanupAfterMs / 1000)} seconds.
            </div>
            <div style={{ marginTop: 2, fontSize: 12, color: 'var(--text-secondary)' }}>
              Note: this is preview only. Original file format may be different when downloaded.
            </div>
            <div
              role="presentation"
              onMouseDown={startPreviewResize}
              title="Drag to resize"
              style={{
                position: 'absolute',
                width: 14,
                height: 14,
                right: 8,
                bottom: 8,
                cursor: 'nwse-resize',
                borderRight: '2px solid var(--text-secondary)',
                borderBottom: '2px solid var(--text-secondary)',
                opacity: 0.7,
              }}
            />
          </div>
        </OverlayModal>
      )}
    </div>
  );
}

function thStyle(width?: number): React.CSSProperties {
  return {
    padding: '10px 12px',
    textAlign: 'left',
    fontSize: 11,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: 'var(--text-secondary)',
    width: width,
    whiteSpace: 'nowrap',
    background: 'var(--bg-hover)',
  };
}

function tdStyle(width?: number): React.CSSProperties {
  return {
    padding: '10px 12px',
    fontSize: 13,
    width: width,
  };
}

const modalInputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--bg-surface)',
  color: 'var(--text-primary)',
  fontSize: 13,
};

function fileIcon(mime: string | null): string {
  if (!mime) return '📄';
  if (mime.startsWith('image/')) return '🖼';
  if (mime === 'application/pdf') return '📕';
  if (mime.includes('spreadsheet') || mime.includes('excel')) return '📊';
  if (mime.includes('word') || mime.includes('document')) return '📝';
  if (mime === 'application/zip') return '🗜';
  if (mime.startsWith('text/')) return '📃';
  return '📄';
}
