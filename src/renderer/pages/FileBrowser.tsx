/**
 * File Browser page.
 *
 * Paginated, searchable, filterable file table. Supports upload (Electron dialog),
 * download, move to shelf, and delete. Shelf filter shown in a left column. Selection
 * supports bulk operations.
 */
import React, { useEffect, useState, useCallback } from 'react';
import type { FileRecord, ShelfRecord, PaginatedResult } from '../../shared/types';
import type { AddToast } from '../App';
import type { SafeUser } from '../../shared/types';
import { cardStyle, btnStyle } from '../App';

interface Props {
  sessionId: string;
  user: SafeUser;
  addToast: AddToast;
}

const PAGE_SIZE = 25;

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
// Move-to-shelf modal
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
          Move to Shelf
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

// ────────────────────────────────────────
// Main component
// ────────────────────────────────────────

export function FileBrowser({ sessionId, user, addToast }: Props): React.JSX.Element {
  const isAdmin = user.role === 'admin';

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
  const [moveModal, setMoveModal] = useState<string[] | null>(null);
  const [newShelfName, setNewShelfName] = useState('');
  const [addingShelf, setAddingShelf] = useState(false);

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

  const handleUpload = async () => {
    if (!selectedShelf) {
      addToast('warning', 'Select a shelf before uploading');
      return;
    }
    setUploadLoading(true);
    const res = await window.sccfs.files.upload(sessionId, selectedShelf, false);
    setUploadLoading(false);
    if (res.ok) {
      addToast('success', `Uploaded "${res.data.original_name}" successfully`);
      loadFiles();
      loadShelves();
    } else if (res.error?.code !== 'CANCELLED') {
      addToast('error', res.error?.message ?? 'Upload failed');
    }
  };

  const handleDownload = async (fileId: string, name: string) => {
    const res = await window.sccfs.files.download(sessionId, fileId);
    if (res.ok) {
      addToast('success', `Downloaded "${name}"`);
    } else if (res.error?.code !== 'CANCELLED') {
      addToast('error', res.error?.message ?? 'Download failed');
    }
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
      addToast('success', `Shelf "${res.data.name}" created`);
      setNewShelfName('');
      setAddingShelf(false);
      loadShelves();
    } else {
      addToast('error', res.error?.message ?? 'Failed to create shelf');
    }
  };

  const handleDeleteShelf = async (shelfId: string, name: string) => {
    if (!confirm(`Delete shelf "${name}"? Files will be moved to Inbox.`)) return;
    const res = await window.sccfs.shelves.delete(sessionId, shelfId);
    if (res.ok) {
      addToast('success', `Shelf "${name}" deleted`);
      if (selectedShelf === shelfId) setSelectedShelf(undefined);
      loadShelves();
      loadFiles();
    } else {
      addToast('error', res.error?.message ?? 'Failed to delete shelf');
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

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Shelves sidebar */}
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
          Shelves
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
            {isAdmin && !s.is_system && (
              <button
                onClick={() => handleDeleteShelf(s.id, s.name)}
                title="Delete shelf"
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

        {isAdmin && (
          <div style={{ marginTop: 8 }}>
            {addingShelf ? (
              <>
                <input
                  autoFocus
                  value={newShelfName}
                  onChange={(e) => setNewShelfName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleCreateShelf(); if (e.key === 'Escape') setAddingShelf(false); }}
                  placeholder="Shelf name"
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
                + New Shelf
              </button>
            )}
          </div>
        )}
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
            {selectedIds.length > 0 && (
              <>
                <button
                  onClick={() => setMoveModal(selectedIds)}
                  style={btnStyle('secondary', true)}
                >
                  📂 Move ({selectedIds.length})
                </button>
                {isAdmin && (
                  <button
                    onClick={() => handleDelete(selectedIds)}
                    style={btnStyle('danger', true)}
                  >
                    🗑 Delete ({selectedIds.length})
                  </button>
                )}
              </>
            )}
            <button
              onClick={handleUpload}
              disabled={uploadLoading}
              style={btnStyle('primary', true)}
            >
              {uploadLoading ? '⏳ Uploading…' : '⬆ Upload'}
            </button>
          </div>
        </div>

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
                  <th style={thStyle(100)}>Shelf</th>
                  <th style={thStyle(90)}>Size</th>
                  <th style={thStyle(60)}>Enc.</th>
                  <th style={thStyle(130)}>Uploaded</th>
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
                      {search ? 'No files match your search' : 'No files in this shelf yet'}
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
                      <td style={{ ...tdStyle(90), color: 'var(--text-secondary)', fontSize: 12 }}>
                        {f.uploader_name}
                      </td>
                      <td style={tdStyle(120)}>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button
                            onClick={() => handleDownload(f.id, f.original_name)}
                            style={btnStyle('ghost', true)}
                            title="Download"
                          >
                            ⬇
                          </button>
                          <button
                            onClick={() => setMoveModal([f.id])}
                            style={btnStyle('ghost', true)}
                            title="Move"
                          >
                            📂
                          </button>
                          {isAdmin && (
                            <button
                              onClick={() => handleDelete([f.id])}
                              style={{ ...btnStyle('ghost', true), color: 'var(--danger)' }}
                              title="Delete"
                            >
                              🗑
                            </button>
                          )}
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
