/**
 * File Browser page.
 *
 * Paginated, searchable, filterable file table. Supports upload (Electron dialog),
 * download, move to folder, and delete. Folder filter shown in a left column. Selection
 * supports bulk operations.
 */
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import createDOMPurify from 'dompurify';
import type { FileRecord, ShelfRecord, PaginatedResult, SourceHandlingMode } from '../../shared/types';
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

function fmtBytes(b: number): string {
  if (b >= 1e9) return `${(b / 1e9).toFixed(2)} GB`;
  if (b >= 1e6) return `${(b / 1e6).toFixed(1)} MB`;
  if (b >= 1e3) return `${(b / 1e3).toFixed(0)} KB`;
  return `${b} B`;
}

function fmtDate(ts: string): string {
  return new Date(ts).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
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
  const [sourceHandlingModalResolve, setSourceHandlingModalResolve] = useState<((mode: SourceHandlingMode) => void) | null>(null);
  const [showUploadPasswordModal, setShowUploadPasswordModal] = useState(false);
  const [pendingUploadMode, setPendingUploadMode] = useState<SourceHandlingMode>('keep_original');
  const [pendingUploadSourcePaths, setPendingUploadSourcePaths] = useState<string[]>([]);
  const [uploadPasswordError, setUploadPasswordError] = useState<string | null>(null);
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
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [renameModal, setRenameModal] = useState<{ fileId: string; currentName: string } | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const [deleteConfirmModal, setDeleteConfirmModal] = useState<{ type: 'file' | 'folder'; ids?: string[]; name?: string } | null>(null);
  const [folderContentsModal, setFolderContentsModal] = useState<{
    shelfId: string;
    shelfName: string;
    fileCount: number;
    files: string[];
  } | null>(null);
  const [contentsAction, setContentsAction] = useState<'move' | 'temp' | null>(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'date'>('name');
  const [sortAsc, setSortAsc] = useState(true);
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

  // Sort files by name or date
  const sortedFiles = useMemo(() => {
    const sorted = [...files.items];
    if (sortBy === 'name') {
      sorted.sort((a, b) => {
        const aName = a.original_name.toLowerCase();
        const bName = b.original_name.toLowerCase();
        return sortAsc ? aName.localeCompare(bName) : bName.localeCompare(aName);
      });
    } else if (sortBy === 'date') {
      sorted.sort((a, b) => {
        const aDate = new Date(a.created_at).getTime();
        const bDate = new Date(b.created_at).getTime();
        return sortAsc ? aDate - bDate : bDate - aDate;
      });
    }
    return sorted;
  }, [files.items, sortBy, sortAsc]);

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

  const performUpload = async (encrypt: boolean, encryptionPassword?: string) => {
    if (!selectedShelf) return;
    setUploadLoading(true);
    const effectiveMode = pendingUploadMode;
    const sourcePaths = pendingUploadSourcePaths.length > 0 ? pendingUploadSourcePaths : undefined;
    const res = await window.sccfs.files.upload(
      sessionId,
      selectedShelf,
      encrypt,
      encryptionPassword,
      effectiveMode,
      false,
      sourcePaths,
    );
    setUploadLoading(false);
    setPendingUploadSourcePaths([]);
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
  };

  const resolveSourceHandlingChoice = async (): Promise<void> => {
    if (sourceHandlingMode !== 'ask_each_time') {
      setPendingUploadMode(sourceHandlingMode);
      return;
    }
    await new Promise<void>((resolve) => {
      setSourceHandlingModalResolve(() => (mode: SourceHandlingMode) => {
        setPendingUploadMode(mode);
        setShowSourceHandlingModal(false);
        resolve();
      });
      setShowSourceHandlingModal(true);
    });
  };

  const beginUploadPasswordStep = async (sourcePaths: string[]) => {
    setPendingUploadSourcePaths(sourcePaths);
    await resolveSourceHandlingChoice();
    if (uploadPasswordRef.current) uploadPasswordRef.current.value = '';
    if (uploadPasswordConfirmRef.current) uploadPasswordConfirmRef.current.value = '';
    setUploadPasswordError(null);
    setShowUploadPasswordModal(true);
  };

  const handleUpload = async () => {
    if (!selectedShelf) {
      addToast('warning', 'Select a folder before uploading');
      return;
    }

    const pickRes = await window.sccfs.files.pickUploadSources(sessionId);
    if (!pickRes.ok) {
      if (pickRes.error?.code !== 'CANCELLED') {
        addToast('error', pickRes.error?.message ?? 'Failed to select files');
      }
      return;
    }

    const sourcePaths = pickRes.data.filePaths;
    if (sourcePaths.length === 0) {
      addToast('warning', 'No files selected');
      return;
    }

    await beginUploadPasswordStep(sourcePaths);
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

  const handleSubmitUploadPassword = async () => {
    const password = uploadPasswordRef.current?.value ?? '';
    const confirmPassword = uploadPasswordConfirmRef.current?.value ?? '';
    const validation = validateEncryptionPasswords(password, confirmPassword);
    if (validation) {
      setUploadPasswordError(validation);
      return;
    }
    setShowUploadPasswordModal(false);
    await performUpload(true, password);
    if (uploadPasswordRef.current) uploadPasswordRef.current.value = '';
    if (uploadPasswordConfirmRef.current) uploadPasswordConfirmRef.current.value = '';
    setUploadPasswordError(null);
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
    setDeleteConfirmModal({ type: 'file', ids });
  };

  const confirmDelete = async () => {
    if (!deleteConfirmModal || deleteConfirmModal.type !== 'file' || !deleteConfirmModal.ids) return;
    
    // Staff users cannot delete files
    if (user.role !== 'admin') {
      addToast('error', 'Only admins can delete files');
      setDeleteConfirmModal(null);
      return;
    }

    const ids = deleteConfirmModal.ids;
    setDeleteConfirmModal(null);
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
    // Staff users cannot delete folders
    if (user.role !== 'admin') {
      addToast('error', 'Only admins can delete folders');
      return;
    }

    // Check if shelf has contents
    const contentsRes = await window.sccfs.shelves.checkContents(sessionId, shelfId);
    if (!contentsRes.ok) {
      addToast('error', contentsRes.error?.message ?? 'Failed to check folder contents');
      return;
    }

    if (contentsRes.data.fileCount > 0) {
      // Show modal to create new folder and move files
      setFolderContentsModal({
        shelfId,
        shelfName: name,
        fileCount: contentsRes.data.fileCount,
        files: contentsRes.data.files,
      });
      setContentsAction('move');
      setNewFolderName('');
    } else {
      // No contents, delete immediately
      const res = await window.sccfs.shelves.delete(sessionId, shelfId);
      if (res.ok) {
        addToast('success', `Folder "${name}" deleted`);
        if (selectedShelf === shelfId) setSelectedShelf(undefined);
        loadShelves();
        loadFiles();
      } else {
        addToast('error', res.error?.message ?? 'Failed to delete folder');
      }
    }
  };

  const confirmDeleteShelf = async () => {
    if (!deleteConfirmModal || deleteConfirmModal.type !== 'folder' || !deleteConfirmModal.ids || !deleteConfirmModal.name) return;
    const shelfId = deleteConfirmModal.ids[0];
    const name = deleteConfirmModal.name;
    setDeleteConfirmModal(null);
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

  const handleFolderContentsAction = async () => {
    if (!folderContentsModal) return;

    setFolderContentsModal(null);

    // Create new folder first
    if (!newFolderName.trim()) {
      addToast('error', 'Please enter a folder name');
      setNewFolderName('');
      setContentsAction(null);
      return;
    }

    const createRes = await window.sccfs.shelves.create(sessionId, newFolderName);
    if (!createRes.ok) {
      addToast('error', createRes.error?.message ?? 'Failed to create folder');
      setNewFolderName('');
      setContentsAction(null);
      return;
    }

    const newFolderId = createRes.data.id;

    // Now delete original folder and move files
    const deleteRes = await window.sccfs.shelves.delete(sessionId, folderContentsModal.shelfId, {
      action: 'move',
      targetShelfId: newFolderId,
    });
    if (deleteRes.ok) {
      addToast('success', `Folder "${folderContentsModal.shelfName}" deleted and files moved to "${newFolderName}"`);
      if (selectedShelf === folderContentsModal.shelfId) setSelectedShelf(undefined);
      loadShelves();
      loadFiles();
    } else {
      addToast('error', deleteRes.error?.message ?? 'Failed to delete folder');
    }

    setNewFolderName('');
    setContentsAction(null);
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

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFiles(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget === e.target) {
      setIsDraggingFiles(false);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFiles(false);

    if (!selectedShelf) {
      addToast('warning', 'Select a folder before uploading');
      return;
    }

    const droppedFiles = Array.from(e.dataTransfer.files);
    if (droppedFiles.length === 0) return;

    const sourcePaths = droppedFiles
      .map((file) => window.sccfs.files.getPathForFile(file))
      .filter((value): value is string => typeof value === 'string' && value.length > 0);

    if (sourcePaths.length === 0) {
      addToast('error', 'Could not read dropped file paths. Please use the Upload button.');
      return;
    }

    void beginUploadPasswordStep(sourcePaths);
  };

  const handleRename = async () => {
    if (!renameModal) return;
    const trimmed = renameValue.trim();
    if (!trimmed) {
      setRenameError('File name cannot be empty');
      return;
    }
    if (trimmed === renameModal.currentName) {
      setRenameModal(null);
      setRenameValue('');
      return;
    }

    const res = await window.sccfs.files.rename(sessionId, renameModal.fileId, trimmed);
    if (res.ok) {
      addToast('success', `Renamed to "${trimmed}"`);
      setRenameModal(null);
      setRenameValue('');
      setRenameError(null);
      loadFiles();
    } else {
      setRenameError(res.error?.message ?? 'Rename failed');
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
                disabled={user.role !== 'admin'}
                title={user.role !== 'admin' ? 'Only admins can delete folders' : 'Delete folder'}
                style={{
                  background: 'none',
                  border: 'none',
                  color: user.role !== 'admin' ? 'var(--text-secondary)' : 'var(--danger)',
                  cursor: user.role !== 'admin' ? 'not-allowed' : 'pointer',
                  padding: '4px 6px',
                  fontSize: 12,
                  opacity: user.role !== 'admin' ? 0.5 : 1,
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
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
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
                background: sourceHandlingMode === 'move_to_system' ? '#fffbeb' : 'var(--bg-surface)',
                color: sourceHandlingMode === 'move_to_system' ? '#b45309' : 'var(--text-primary)',
                fontSize: 12,
              }}
              title="Source file handling after upload"
            >
              <option value="ask_each_time">Ask each time</option>
              <option value="keep_original">Keep originals</option>
              <option value="move_to_system">Move originals to system</option>
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
                  disabled={user.role !== 'admin'}
                  style={{
                    ...btnStyle('danger', true),
                    opacity: user.role !== 'admin' ? 0.5 : 1,
                    cursor: user.role !== 'admin' ? 'not-allowed' : 'pointer',
                  }}
                >
                  🗑 Delete ({selectedIds.length})
                </button>
              </>
            )}
            <button
              onClick={handleUpload}
              disabled={uploadLoading}
              style={{
                ...btnStyle('primary', true),
                opacity: uploadLoading ? 0.5 : 1,
                cursor: uploadLoading ? 'not-allowed' : 'pointer',
              }}
            >
              {uploadLoading ? '⏳ Uploading…' : '⬆ Upload'}
            </button>
          </div>
        </div>
        {sourceHandlingMode === 'move_to_system' && (
          <div
            style={{
              padding: '8px 20px',
              borderBottom: '1px solid var(--border)',
              background: '#fef3c7',
              color: '#92400e',
              fontSize: 12,
            }}
          >
            Note: originals are only removed after full per-file success; files are sent to recycle bin/trash by default.
          </div>
        )}
        {user.role !== 'admin' && (
          <div
            style={{
              padding: '8px 20px',
              borderBottom: '1px solid var(--border)',
              background: 'rgba(79, 70, 229, 0.08)',
              color: '#4f46e5',
              fontSize: 12,
            }}
          >
            🔒 You have view-only access. Upload, move, rename, and delete operations are restricted to administrators.
          </div>
        )}

        {/* Table */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: 20,
            position: 'relative',
            border: isDraggingFiles ? '3px dashed var(--accent)' : 'none',
            background: isDraggingFiles ? 'rgba(79, 70, 229, 0.05)' : 'transparent',
            transition: 'all 0.2s ease',
          }}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
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
                  <th style={thStyle()}>
                    <button
                      onClick={() => {
                        if (sortBy === 'name') {
                          setSortAsc(!sortAsc);
                        } else {
                          setSortBy('name');
                          setSortAsc(true);
                        }
                      }}
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: 'inherit',
                        padding: 0,
                        font: 'inherit',
                      }}
                      title="Click to sort by name"
                    >
                      Name {sortBy === 'name' && (sortAsc ? '↑' : '↓')}
                    </button>
                  </th>
                  <th style={thStyle(100)}>Folder</th>
                  <th style={thStyle(90)}>Size</th>
                  <th style={thStyle(60)}>Enc.</th>
                  <th style={thStyle(130)}>
                    <button
                      onClick={() => {
                        if (sortBy === 'date') {
                          setSortAsc(!sortAsc);
                        } else {
                          setSortBy('date');
                          setSortAsc(false);
                        }
                      }}
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: 'inherit',
                        padding: 0,
                        font: 'inherit',
                      }}
                      title="Click to sort by upload date"
                    >
                      Uploaded {sortBy === 'date' && (sortAsc ? '↑' : '↓')}
                    </button>
                  </th>
                  <th style={thStyle(90)}>By</th>
                  <th style={thStyle(120)}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td
                      colSpan={8}
                      style={{ textAlign: 'center', padding: 32, color: 'var(--text-secondary)' }}
                    >
                      Loading…
                    </td>
                  </tr>
                ) : files.items.length === 0 ? (
                  <tr>
                    <td
                      colSpan={8}
                      style={{ textAlign: 'center', padding: 32, color: 'var(--text-secondary)' }}
                    >
                      {search ? 'No files match your search' : 'No files in this folder yet'}
                    </td>
                  </tr>
                ) : (
                  sortedFiles.map((f: FileRecord) => (
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
                      <td style={{ ...tdStyle(90), color: 'var(--text-secondary)', fontSize: 12 }}>
                        {f.uploaded_by ?? 'system'}
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
                            onClick={() => {
                              setRenameModal({ fileId: f.id, currentName: f.original_name });
                              setRenameValue(f.original_name);
                              setRenameError(null);
                            }}
                            style={btnStyle('ghost', true)}
                            title="Rename"
                          >
                            ✏
                          </button>
                          <button
                            onClick={() => handleDelete([f.id])}
                            disabled={user.role !== 'admin'}
                            title={user.role !== 'admin' ? 'Only admins can delete files' : 'Delete'}
                            style={{
                              ...btnStyle('ghost', true),
                              color: 'var(--danger)',
                              opacity: user.role !== 'admin' ? 0.5 : 1,
                              cursor: user.role !== 'admin' ? 'not-allowed' : 'pointer',
                            }}
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
            Move uploaded files to system storage after successful upload?
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              onClick={() => {
                sourceHandlingModalResolve?.('keep_original');
                setSourceHandlingModalResolve(null);
              }}
              style={btnStyle('secondary', true)}
            >
              Keep Originals
            </button>
            <button
              onClick={() => {
                sourceHandlingModalResolve?.('move_to_system');
                setSourceHandlingModalResolve(null);
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
              onClick={() => {
                setShowUploadPasswordModal(false);
                setPendingUploadSourcePaths([]);
                if (uploadPasswordRef.current) uploadPasswordRef.current.value = '';
                if (uploadPasswordConfirmRef.current) uploadPasswordConfirmRef.current.value = '';
                setUploadPasswordError(null);
                addToast('info', 'Upload cancelled before processing.');
              }}
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

      {/* Rename Modal */}
      {renameModal && (
        <OverlayModal>
          <h3 style={{ marginTop: 0, marginBottom: 12 }}>Rename File</h3>
          <p style={{ marginTop: 0, marginBottom: 12, color: 'var(--text-secondary)', fontSize: 13 }}>
            Current name: <strong>{renameModal.currentName}</strong>
          </p>
          <input
            autoFocus
            type="text"
            value={renameValue}
            onChange={(e) => {
              setRenameValue(e.target.value);
              setRenameError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleRename();
              }
              if (e.key === 'Escape') {
                setRenameModal(null);
                setRenameValue('');
                setRenameError(null);
              }
            }}
            placeholder="New file name"
            style={modalInputStyle}
          />
          {renameError && (
            <div style={{ marginTop: 8, color: 'var(--danger)', fontSize: 12 }}>{renameError}</div>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <button
              onClick={() => {
                setRenameModal(null);
                setRenameValue('');
                setRenameError(null);
              }}
              style={btnStyle('secondary', true)}
            >
              Cancel
            </button>
            <button
              onClick={() => void handleRename()}
              style={btnStyle('primary', true)}
            >
              Rename
            </button>
          </div>
        </OverlayModal>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirmModal && (
        <OverlayModal>
          <h3 style={{ marginTop: 0, marginBottom: 12, color: 'var(--danger)' }}>
            {deleteConfirmModal.type === 'file' ? '🗑 Delete Files' : '🗑 Delete Folder'}
          </h3>
          {deleteConfirmModal.type === 'file' ? (
            <p style={{ marginTop: 0, marginBottom: 16, color: 'var(--text-secondary)', fontSize: 13 }}>
              Delete {deleteConfirmModal.ids?.length} file(s)? This cannot be undone.
            </p>
          ) : (
            <p style={{ marginTop: 0, marginBottom: 16, color: 'var(--text-secondary)', fontSize: 13 }}>
              Delete folder <strong>"{deleteConfirmModal.name}"</strong>? Files will be moved to Inbox. This cannot be undone.
            </p>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              onClick={() => setDeleteConfirmModal(null)}
              style={btnStyle('secondary', true)}
            >
              Cancel
            </button>
            <button
              onClick={() => void (deleteConfirmModal.type === 'file' ? confirmDelete() : confirmDeleteShelf())}
              style={btnStyle('danger', true)}
            >
              Delete
            </button>
          </div>
        </OverlayModal>
      )}

      {/* Folder Contents Modal */}
      {folderContentsModal && (
        <OverlayModal>
          <h3 style={{ marginTop: 0, marginBottom: 12, color: 'var(--danger)' }}>
            ⚠️ Folder Contains {folderContentsModal.fileCount} File(s)
          </h3>
          <p style={{ marginTop: 0, marginBottom: 16, color: 'var(--text-secondary)', fontSize: 13 }}>
            The folder <strong>"{folderContentsModal.shelfName}"</strong> contains {folderContentsModal.fileCount} file(s).
            Create a new folder to move them to:
          </p>

          {/* Preview of files */}
          <div
            style={{
              background: 'var(--bg-hover)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              padding: 8,
              marginBottom: 16,
              maxHeight: 120,
              overflowY: 'auto',
              fontSize: 12,
              color: 'var(--text-secondary)',
            }}
          >
            {folderContentsModal.files.map((file, idx) => (
              <div key={idx} style={{ padding: '2px 4px' }}>
                • {file}
              </div>
            ))}
          </div>

          {/* Folder Name Input */}
          <div style={{ marginBottom: 16 }}>
            <input
              autoFocus
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleFolderContentsAction();
                }
              }}
              placeholder="Enter new folder name..."
              style={{
                width: '100%',
                padding: '6px 8px',
                borderRadius: 4,
                border: '1px solid var(--border)',
                background: 'var(--bg)',
                color: 'var(--text-primary)',
                fontSize: 13,
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              onClick={() => {
                setFolderContentsModal(null);
                setContentsAction(null);
                setNewFolderName('');
              }}
              style={btnStyle('secondary', true)}
            >
              Cancel
            </button>
            <button
              onClick={() => void handleFolderContentsAction()}
              disabled={!newFolderName.trim()}
              style={{
                ...btnStyle('danger', true),
                opacity: !newFolderName.trim() ? 0.5 : 1,
                cursor: !newFolderName.trim() ? 'not-allowed' : 'pointer',
              }}
            >
              Delete Folder
            </button>
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
