/**
 * Activity Log page.
 *
 * Displays a filtered, paginated activity table with search/filter controls.
 * Includes a heatmap showing activity density by hour × day-of-week.
 * Supports CSV export and browser-native print.
 */
import React, { useEffect, useState, useCallback } from 'react';
import type { ActivityRecord, PaginatedResult } from '../../shared/types';
import type { AddToast } from '../App';
import type { SafeUser } from '../../shared/types';
import { cardStyle, btnStyle } from '../App';

interface Props {
  sessionId: string;
  user: SafeUser;
  addToast: AddToast;
}

const PAGE_SIZE = 50;

const ACTIONS = [
  'LOGIN', 'LOGOUT', 'LOGIN_FAILED', 'ACCOUNT_LOCKED',
  'CHANGE_PASSWORD', 'CREATE_USER', 'UPDATE_USER', 'DELETE_USER',
  'RESET_PASSWORD', 'UNLOCK_USER', 'FILE_UPLOAD', 'FILE_DOWNLOAD',
  'FILE_DELETE', 'FILE_MOVE', 'SHELF_CREATE', 'SHELF_DELETE',
  'SHELF_RENAME', 'STORAGE_BACKUP', 'STORAGE_RESTORE', 'SESSION_TERMINATE',
];

const ACTION_COLORS: Record<string, string> = {
  LOGIN: '#16a34a', LOGOUT: '#64748b', LOGIN_FAILED: '#dc2626',
  ACCOUNT_LOCKED: '#dc2626', CHANGE_PASSWORD: '#0284c7',
  FILE_UPLOAD: '#7c3aed', FILE_DOWNLOAD: '#0369a1', FILE_DELETE: '#b45309',
  CREATE_USER: '#15803d', DELETE_USER: '#dc2626', UPDATE_USER: '#d97706',
};

function fmtDateTime(ts: string): string {
  return new Date(ts).toLocaleString([], { dateStyle: 'short', timeStyle: 'medium' });
}

// ────────────────────────────────────────
// Activity heatmap (hour × day-of-week)
// ────────────────────────────────────────

function ActivityHeatmap({ items }: { items: ActivityRecord[] }) {
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const HOURS = Array.from({ length: 24 }, (_, i) => i);

  // Build count matrix [day][hour]
  const matrix = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  let max = 0;

  for (const item of items) {
    const d = new Date(item.created_at);
    const day = d.getDay();
    const hour = d.getHours();
    matrix[day][hour]++;
    if (matrix[day][hour] > max) max = matrix[day][hour];
  }

  const cellColor = (count: number): string => {
    if (count === 0) return 'var(--bg-hover)';
    const intensity = Math.max(0.15, count / Math.max(max, 1));
    const r = Math.round(79 + (20 - 79) * intensity);
    const g = Math.round(70 + (39 - 70) * intensity);
    const b = Math.round(229 + (205 - 229) * intensity);
    return `rgba(${r},${g},${b},${intensity})`;
  };

  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
        <div style={{ width: 32 }} />
        {HOURS.map((h) => (
          <div
            key={h}
            style={{
              width: 18,
              fontSize: 9,
              textAlign: 'center',
              color: 'var(--text-secondary)',
            }}
          >
            {h % 4 === 0 ? h : ''}
          </div>
        ))}
      </div>
      {DAYS.map((day, di) => (
        <div key={day} style={{ display: 'flex', gap: 4, marginBottom: 4, alignItems: 'center' }}>
          <div
            style={{
              width: 32,
              fontSize: 10,
              color: 'var(--text-secondary)',
              textAlign: 'right',
              paddingRight: 4,
            }}
          >
            {day}
          </div>
          {HOURS.map((h) => (
            <div
              key={h}
              title={`${day} ${h}:00 — ${matrix[di][h]} events`}
              style={{
                width: 18,
                height: 18,
                borderRadius: 3,
                background: cellColor(matrix[di][h]),
                border: '1px solid var(--border)',
              }}
            />
          ))}
        </div>
      ))}
      <div
        style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 4, textAlign: 'right' }}
      >
        ← less · more →&nbsp;
        <span
          style={{
            display: 'inline-block',
            width: 40,
            height: 8,
            background: 'linear-gradient(to right, var(--bg-hover), #4f46e5)',
            borderRadius: 2,
            verticalAlign: 'middle',
          }}
        />
      </div>
    </div>
  );
}

// ────────────────────────────────────────
// CSV export
// ────────────────────────────────────────

function exportCsv(items: ActivityRecord[]) {
  const header = 'Timestamp,User,Action,Detail';
  const rows = items.map((a) =>
    [
      `"${a.created_at}"`,
      `"${a.username ?? 'system'}"`,
      `"${a.action}"`,
      `"${(a.detail ?? '').replace(/"/g, '""')}"`,
    ].join(','),
  );
  const csv = [header, ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `sccfs-activity-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ────────────────────────────────────────
// Main
// ────────────────────────────────────────

export function ActivityLog({ sessionId, user: _user, addToast }: Props): React.JSX.Element {
  const [result, setResult] = useState<PaginatedResult<ActivityRecord>>({
    items: [], total: 0, page: 1, pageSize: PAGE_SIZE,
  });
  const [allItems, setAllItems] = useState<ActivityRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [filterAction, setFilterAction] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const res = await window.sccfs.activity.list(sessionId, {
      action: filterAction || undefined,
      dateFrom: filterDateFrom || undefined,
      dateTo: filterDateTo || undefined,
      page,
      pageSize: PAGE_SIZE,
    });
    if (res.ok) setResult(res.data);
    else addToast('error', res.error?.message ?? 'Failed to load activity');
    setLoading(false);
  }, [sessionId, filterAction, filterDateFrom, filterDateTo, page, addToast]);

  // Load all items (for heatmap) — unfiltered, large batch
  const loadAll = useCallback(async () => {
    const res = await window.sccfs.activity.list(sessionId, { page: 1, pageSize: 100 });
    if (res.ok) setAllItems(res.data.items);
  }, [sessionId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));

  const applyFilters = () => {
    setPage(1);
    load();
  };

  const clearFilters = () => {
    setFilterAction('');
    setFilterDateFrom('');
    setFilterDateTo('');
    setPage(1);
  };

  const handlePrint = () => window.print();

  return (
    <div style={{ padding: 28 }}>
      {/* Print header (hidden on screen) */}
      <div className="print-only" style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 18 }}>SCCFS — Activity Log</h1>
        <p style={{ fontSize: 12, color: '#666' }}>
          Printed: {new Date().toLocaleString()} · Filters: {filterAction || 'all actions'} ·{' '}
          {filterDateFrom || 'any start'} → {filterDateTo || 'any end'}
        </p>
        <hr style={{ margin: '8px 0' }} />
      </div>

      {/* Screen header */}
      <div
        className="no-print"
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}
      >
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>Activity Log</h1>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
            Security and operation audit trail
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => exportCsv(result.items)} style={btnStyle('secondary')}>
            ⬇ Export CSV
          </button>
          <button onClick={handlePrint} style={btnStyle('secondary')}>
            🖨 Print
          </button>
        </div>
      </div>

      {/* Filters */}
      <div
        className="no-print"
        style={{ ...cardStyle(), display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20, padding: '14px 20px' }}
      >
        <div>
          <label style={labelStyle}>Action</label>
          <select
            value={filterAction}
            onChange={(e) => setFilterAction(e.target.value)}
            style={selectStyle}
          >
            <option value="">All Actions</option>
            {ACTIONS.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={labelStyle}>From</label>
          <input
            type="date"
            value={filterDateFrom}
            onChange={(e) => setFilterDateFrom(e.target.value)}
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>To</label>
          <input
            type="date"
            value={filterDateTo}
            onChange={(e) => setFilterDateTo(e.target.value)}
            style={inputStyle}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
          <button onClick={applyFilters} style={btnStyle('primary', true)}>
            Apply
          </button>
          <button onClick={clearFilters} style={btnStyle('secondary', true)}>
            Clear
          </button>
        </div>
        <div style={{ marginLeft: 'auto', alignSelf: 'flex-end', fontSize: 13, color: 'var(--text-secondary)' }}>
          {result.total.toLocaleString()} record{result.total !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Two-column: table + heatmap */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 20 }}>
        {/* Table */}
        <div>
          <div style={{ ...cardStyle(), padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--bg-hover)', borderBottom: '1px solid var(--border)' }}>
                  {['Timestamp', 'User', 'Action', 'Detail'].map((h) => (
                    <th key={h} style={thStyle()}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={4} style={{ textAlign: 'center', padding: 32, color: 'var(--text-secondary)' }}>
                      Loading…
                    </td>
                  </tr>
                ) : result.items.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ textAlign: 'center', padding: 32, color: 'var(--text-secondary)' }}>
                      No activity records found
                    </td>
                  </tr>
                ) : (
                  result.items.map((a: ActivityRecord) => (
                    <tr key={a.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ ...tdStyle(), color: 'var(--text-secondary)', whiteSpace: 'nowrap', fontSize: 12 }}>
                        {fmtDateTime(a.created_at)}
                      </td>
                      <td style={{ ...tdStyle(), fontWeight: 500 }}>
                        {a.username ?? <span style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>system</span>}
                      </td>
                      <td style={tdStyle()}>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            color: ACTION_COLORS[a.action] ?? 'var(--text-secondary)',
                            background: `${ACTION_COLORS[a.action] ?? '#64748b'}1a`,
                            padding: '2px 7px',
                            borderRadius: 4,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {a.action}
                        </span>
                      </td>
                      <td style={{ ...tdStyle(), color: 'var(--text-secondary)', maxWidth: 360 }}>
                        <span
                          style={{
                            display: 'block',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {a.detail ?? '—'}
                        </span>
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
              className="no-print"
              style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 14, alignItems: 'center' }}
            >
              <button onClick={() => setPage(1)} disabled={page === 1} style={btnStyle('secondary', true)}>
                «
              </button>
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} style={btnStyle('secondary', true)}>
                ‹
              </button>
              <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                Page {page} / {totalPages}
              </span>
              <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} style={btnStyle('secondary', true)}>
                ›
              </button>
              <button onClick={() => setPage(totalPages)} disabled={page === totalPages} style={btnStyle('secondary', true)}>
                »
              </button>
            </div>
          )}
        </div>

        {/* Heatmap */}
        <div
          className="no-print"
          style={{ ...cardStyle(), minWidth: 520 }}
        >
          <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 14, color: 'var(--text-primary)' }}>
            Activity Heatmap (recent 100 events)
          </h3>
          <ActivityHeatmap items={allItems} />
        </div>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--text-secondary)',
  marginBottom: 4,
  textTransform: 'uppercase',
  letterSpacing: 0.3,
};

const inputStyle: React.CSSProperties = {
  padding: '7px 10px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--bg-surface)',
  color: 'var(--text-primary)',
  fontSize: 13,
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  minWidth: 160,
};

function thStyle(): React.CSSProperties {
  return {
    padding: '10px 16px',
    textAlign: 'left',
    fontSize: 11,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: 'var(--text-secondary)',
    whiteSpace: 'nowrap',
  };
}

function tdStyle(): React.CSSProperties {
  return { padding: '9px 16px', fontSize: 13 };
}
