/**
 * Storage & Backup page (admin only).
 *
 * Shows a quota progress bar, per-shelf storage bar chart, 30-day cumulative
 * storage trend line, and backup / restore controls.
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  LineChart, Line,
} from 'recharts';
import type { StorageStats } from '../../shared/types';
import type { AddToast } from '../App';
import type { SafeUser } from '../../shared/types';
import { cardStyle, btnStyle } from '../App';

interface Props {
  sessionId: string;
  user: SafeUser;
  addToast: AddToast;
}

function fmtBytes(b: number): string {
  if (b >= 1e9) return `${(b / 1e9).toFixed(2)} GB`;
  if (b >= 1e6) return `${(b / 1e6).toFixed(1)} MB`;
  if (b >= 1e3) return `${(b / 1e3).toFixed(0)} KB`;
  return `${b} B`;
}

// ────────────────────────────────────────
// Set Quota modal
// ────────────────────────────────────────

function SetQuotaModal({
  current,
  maxQuota,
  sessionId,
  addToast,
  onClose,
  onDone,
}: {
  current: number;
  maxQuota: number;
  sessionId: string;
  addToast: AddToast;
  onClose: () => void;
  onDone: () => void;
}) {
  const [value, setValue] = useState(String(Math.round(current / 1e9)));
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const gb = parseFloat(value);
    if (isNaN(gb) || gb <= 0) {
      addToast('error', 'Enter a valid quota in GB');
      return;
    }

    const nextQuotaBytes = Math.round(gb * 1e9);
    if (nextQuotaBytes > maxQuota) {
      addToast('error', `Quota cannot exceed current drive capacity (${fmtBytes(maxQuota)}).`);
      return;
    }

    setLoading(true);
    const res = await window.sccfs.storage.setQuota(sessionId, nextQuotaBytes);
    setLoading(false);
    if (res.ok) {
      addToast('success', `Quota set to ${gb} GB`);
      onDone();
      onClose();
    } else {
      addToast('error', res.error?.message ?? 'Failed to set quota');
    }
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      }}
    >
      <form onSubmit={handleSubmit} style={{ ...cardStyle(), width: 360 }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 20, color: 'var(--text-primary)' }}>
          Set Storage Quota
        </h3>
        <label style={labelStyle}>Quota (GB)</label>
        <input
          type="number"
          min="1"
          step="1"
          value={value}
          max={Math.max(1, Math.floor(maxQuota / 1e9))}
          onChange={(e) => setValue(e.target.value)}
          style={inputStyle}
          autoFocus
        />
        <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 20 }}>
          Maximum allowed right now: {fmtBytes(maxQuota)} (based on active drive free space).
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={btnStyle('secondary', true)}>Cancel</button>
          <button type="submit" disabled={loading} style={btnStyle('primary', true)}>
            {loading ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ────────────────────────────────────────
// Confirmation modals
// ────────────────────────────────────────

function BackupConfirmModal({
  onConfirm,
  onCancel,
  loading,
}: {
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
}) {
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
      <div style={{ ...cardStyle(), width: 400 }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, color: 'var(--text-primary)' }}>
          💾 Create Backup
        </h3>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20, lineHeight: 1.5 }}>
          This will create a complete backup of all files and the database. The backup can be restored later if needed.
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} disabled={loading} style={btnStyle('secondary', true)}>
            Cancel
          </button>
          <button onClick={onConfirm} disabled={loading} style={btnStyle('primary', true)}>
            {loading ? 'Creating…' : 'Create Backup'}
          </button>
        </div>
      </div>
    </div>
  );
}

function RestoreConfirmModal({
  onConfirm,
  onCancel,
  loading,
}: {
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
}) {
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
      <div style={{ ...cardStyle(), width: 400 }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, color: 'var(--danger)' }}>
          🔄 Restore Backup
        </h3>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20, lineHeight: 1.5 }}>
          <strong>Warning:</strong> This will replace the current database with the backup. All recent changes since the backup was created will be lost. This cannot be undone.
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} disabled={loading} style={btnStyle('secondary', true)}>
            Cancel
          </button>
          <button onClick={onConfirm} disabled={loading} style={btnStyle('danger', true)}>
            {loading ? 'Restoring…' : 'Restore Backup'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────
// Main
// ────────────────────────────────────────

export function StorageBackup({ sessionId, addToast }: Props): React.JSX.Element {
  const [stats, setStats] = useState<StorageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [backupLoading, setBackupLoading] = useState(false);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [showQuotaModal, setShowQuotaModal] = useState(false);
  const [showBackupConfirm, setShowBackupConfirm] = useState(false);
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);

  const load = useCallback(async () => {
    const res = await window.sccfs.storage.stats(sessionId);
    if (res.ok) setStats(res.data);
    else addToast('error', res.error?.message ?? 'Failed to load storage stats');
    setLoading(false);
  }, [sessionId, addToast]);

  useEffect(() => {
    load();
  }, [load]);

  const executeBackup = async () => {
    setBackupLoading(true);
    const res = await window.sccfs.storage.backup(sessionId);
    setBackupLoading(false);
    setShowBackupConfirm(false);
    if (res.ok) {
      addToast('success', `Backup saved to ${res.data.path}`);
    } else if (res.error?.code !== 'CANCELLED') {
      addToast('error', res.error?.message ?? 'Backup failed');
    }
  };

  const executeRestore = async () => {
    setRestoreLoading(true);
    const res = await window.sccfs.storage.restore(sessionId);
    setRestoreLoading(false);
    setShowRestoreConfirm(false);
    if (res.ok) {
      addToast('success', 'Restore completed. Refreshing application state…');
    } else if (res.error?.code !== 'CANCELLED') {
      addToast('error', res.error?.message ?? 'Restore failed');
    }
  };

  const handleBackup = () => {
    setShowBackupConfirm(true);
  };

  const handleRestore = () => {
    setShowRestoreConfirm(true);
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <div
          style={{
            width: 32, height: 32,
            border: '3px solid var(--border)', borderTopColor: 'var(--accent)',
            borderRadius: '50%', animation: 'spin 0.8s linear infinite',
          }}
        />
      </div>
    );
  }

  if (!stats) return <div />;

  const usedPct = stats.quota_bytes > 0
    ? Math.min(100, (stats.used_bytes / stats.quota_bytes) * 100)
    : 0;
  const barColor = usedPct >= 95 ? '#dc2626' : usedPct >= 80 ? '#d97706' : '#4f46e5';

  const shelfChartData = stats.by_shelf.map((s: StorageStats['by_shelf'][number]) => {
    const mb = s.size_bytes / 1e6;
    const displayValue = mb >= 1000 ? mb / 1024 : mb;
    const displayUnit = mb >= 1000 ? 'GB' : 'MB';
    return {
      name: s.shelf_name.length > 12 ? s.shelf_name.slice(0, 12) + '…' : s.shelf_name,
      size_value: displayValue,
      size_unit: displayUnit,
      files: s.file_count,
      tooltipLabel: `${displayValue.toFixed(1)} ${displayUnit}`,
    };
  });

  const trendData = stats.trend.map((t: StorageStats['trend'][number]) => ({
    date: t.date.slice(5),
    mb: parseFloat((t.cumulative_bytes / 1e6).toFixed(1)),
  }));

  return (
    <div style={{ padding: 28 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>
            Storage & Backup
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
            {stats.file_count.toLocaleString()} files · {fmtBytes(stats.used_bytes)} used
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={load} style={btnStyle('secondary', true)}>↺ Refresh</button>
          <button
            onClick={handleBackup}
            disabled={backupLoading}
            style={btnStyle('primary')}
          >
            {backupLoading ? '⏳ Backing up…' : '💾 Backup Now'}
          </button>
          <button
            onClick={handleRestore}
            disabled={restoreLoading}
            style={btnStyle('secondary')}
          >
            {restoreLoading ? '⏳ Restoring…' : '🔄 Restore'}
          </button>
        </div>
      </div>

      {/* Quota bar */}
      <div style={{ ...cardStyle(), marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>Storage Quota</h2>
          <button onClick={() => setShowQuotaModal(true)} style={btnStyle('secondary', true)}>
            ⚙ Set Quota
          </button>
        </div>
        <div
          style={{
            height: 12,
            background: 'var(--border)',
            borderRadius: 6,
            overflow: 'hidden',
            marginBottom: 8,
          }}
        >
          <div
            style={{
              width: `${usedPct}%`,
              height: '100%',
              background: barColor,
              borderRadius: 6,
              transition: 'width .4s',
            }}
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
          <span style={{ color: barColor, fontWeight: 700 }}>{usedPct.toFixed(1)}% used</span>
          <span style={{ color: 'var(--text-secondary)' }}>
            {fmtBytes(stats.used_bytes)} / {fmtBytes(stats.quota_bytes)}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginTop: 8 }}>
          <span style={{ color: 'var(--text-secondary)' }}>
            Active path: {stats.active_storage_path}
          </span>
          <span style={{ color: 'var(--text-secondary)' }}>
            Free on drive: {fmtBytes(stats.drive_free_bytes)}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginTop: 4 }}>
          <span style={{ color: 'var(--text-secondary)' }}>
            Drive usage: {stats.drive_used_percent.toFixed(1)}%
          </span>
          <span style={{ color: 'var(--text-secondary)' }}>
            Max quota now: {fmtBytes(stats.max_quota_bytes)}
          </span>
        </div>
        {usedPct >= 80 && (
          <div
            style={{
              marginTop: 10,
              padding: '8px 12px',
              background: usedPct >= 95 ? '#fef2f2' : '#fffbeb',
              border: `1px solid ${usedPct >= 95 ? '#fecaca' : '#fde68a'}`,
              borderRadius: 6,
              fontSize: 13,
              color: usedPct >= 95 ? '#dc2626' : '#d97706',
            }}
          >
            {usedPct >= 95
              ? '🚨 Storage critically full — new uploads are blocked.'
              : '⚠️ Storage is over 80% full. Consider archiving or expanding quota.'}
          </div>
        )}
      </div>

      {/* Charts row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
        {/* Storage by folder */}
        <div style={cardStyle()}>
          <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16, color: 'var(--text-primary)' }}>
            Storage by Folder
          </h2>
          {shelfChartData.length === 0 ? (
            <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>No data</p>
          ) : (
            <div style={{ overflowY: 'auto', maxHeight: 320 }}>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart
                  data={shelfChartData}
                  layout="vertical"
                  margin={{ top: 0, right: 30, bottom: 0, left: 10 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 11, fill: 'var(--text-secondary)' }}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    tick={{ fontSize: 11, fill: 'var(--text-secondary)' }}
                    tickLine={false}
                    width={80}
                  />
                  <Tooltip
                    formatter={(v, _name, props) => [`${props.payload.tooltipLabel}`, 'Size'] as [string, string]}
                    contentStyle={{
                      background: 'var(--bg-surface)',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="size_value" fill="#4f46e5" radius={[0, 4, 4, 0]} name="Size" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* 30-day trend */}
        <div style={cardStyle()}>
          <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16, color: 'var(--text-primary)' }}>
            Storage Trend — Last 30 Days
          </h2>
          {trendData.length === 0 ? (
            <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>No trend data yet</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={trendData} margin={{ top: 0, right: 10, bottom: 0, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: 'var(--text-secondary)' }}
                    tickLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: 'var(--text-secondary)' }}
                    tickLine={false}
                    unit=" MB"
                  />
                  <Tooltip
                    formatter={(v) => [`${v ?? 0} MB`, 'Cumulative'] as [string, string]}
                    contentStyle={{
                      background: 'var(--bg-surface)',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="mb"
                    stroke="#4f46e5"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                    name="Cumulative (MB)"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* Folder breakdown table */}
      <div style={{ ...cardStyle(), padding: 0, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--bg-hover)', borderBottom: '1px solid var(--border)' }}>
              {['Folder', 'Files', 'Size', 'Share'].map((h) => (
                <th key={h} style={thStyle()}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {stats.by_shelf.map((s: StorageStats['by_shelf'][number]) => {
              const share = stats.used_bytes > 0 ? (s.size_bytes / stats.used_bytes * 100) : 0;
              return (
                <tr key={s.shelf_id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={tdStyle()}>{s.shelf_name}</td>
                  <td style={{ ...tdStyle(), color: 'var(--text-secondary)' }}>
                    {s.file_count.toLocaleString()}
                  </td>
                  <td style={tdStyle()}>{fmtBytes(s.size_bytes)}</td>
                  <td style={{ ...tdStyle(), minWidth: 140 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div
                        style={{
                          flex: 1,
                          height: 6,
                          background: 'var(--border)',
                          borderRadius: 3,
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            width: `${share}%`,
                            height: '100%',
                            background: 'var(--accent)',
                            borderRadius: 3,
                          }}
                        />
                      </div>
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)', minWidth: 36 }}>
                        {share.toFixed(1)}%
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showQuotaModal && (
        <SetQuotaModal
          current={stats.quota_bytes}
          maxQuota={stats.max_quota_bytes}
          sessionId={sessionId}
          addToast={addToast}
          onClose={() => setShowQuotaModal(false)}
          onDone={load}
        />
      )}

      {showBackupConfirm && (
        <BackupConfirmModal
          onConfirm={executeBackup}
          onCancel={() => setShowBackupConfirm(false)}
          loading={backupLoading}
        />
      )}

      {showRestoreConfirm && (
        <RestoreConfirmModal
          onConfirm={executeRestore}
          onCancel={() => setShowRestoreConfirm(false)}
          loading={restoreLoading}
        />
      )}
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--text-secondary)',
  marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--bg-surface)',
  color: 'var(--text-primary)',
  fontSize: 13,
  marginBottom: 14,
};

function thStyle(): React.CSSProperties {
  return {
    padding: '10px 16px', textAlign: 'left', fontSize: 11,
    fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5,
    color: 'var(--text-secondary)',
  };
}

function tdStyle(): React.CSSProperties {
  return { padding: '10px 16px', fontSize: 13 };
}
