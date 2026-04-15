/**
 * User Management page (admin only).
 *
 * Displays a user table with role, status, failed attempts, and lock state.
 * Supports create, update role, toggle active, reset password, unlock, and delete.
 * Includes a role distribution donut and account health summary.
 */
import React, { useEffect, useState, useCallback } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import type { SafeUser } from '../../shared/types';
import type { AddToast } from '../App';
import { cardStyle, btnStyle } from '../App';

interface Props {
  sessionId: string;
  user: SafeUser;
  addToast: AddToast;
}

// ────────────────────────────────────────
// Create / edit modal
// ────────────────────────────────────────

interface UserModalState {
  mode: 'create' | 'reset-password' | 'change-password';
  userId?: string;
  username?: string;
}

function UserModal({
  state,
  sessionId,
  addToast,
  onClose,
  onDone,
}: {
  state: UserModalState;
  sessionId: string;
  addToast: AddToast;
  onClose: () => void;
  onDone: () => void;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [role, setRole] = useState('staff');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (state.mode === 'create') {
        const res = await window.sccfs.users.create(sessionId, username, password, role);
        if (!res.ok) { setError(res.error?.message ?? 'Failed'); return; }
        addToast('success', `User "${username}" created`);
      } else if (state.mode === 'reset-password') {
        const res = await window.sccfs.users.resetPassword(sessionId, state.userId!, password);
        if (!res.ok) { setError(res.error?.message ?? 'Failed'); return; }
        addToast('success', `Password reset for "${state.username}"`);
      } else {
        const res = await window.sccfs.auth.changePassword(sessionId, currentPassword, password);
        if (!res.ok) { setError(res.error?.message ?? 'Failed'); return; }
        addToast('success', 'Password changed');
      }
      onDone();
      onClose();
    } finally {
      setLoading(false);
    }
  };

  const titles = {
    'create': 'Create New User',
    'reset-password': `Reset Password — ${state.username}`,
    'change-password': 'Change My Password',
  };

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
      <form onSubmit={handleSubmit} style={{ ...cardStyle(), width: 400 }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 20, color: 'var(--text-primary)' }}>
          {titles[state.mode]}
        </h3>

        {error && (
          <div
            style={{
              padding: '8px 12px',
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: 6,
              fontSize: 13,
              color: '#dc2626',
              marginBottom: 14,
            }}
          >
            {error}
          </div>
        )}

        {state.mode === 'create' && (
          <>
            <label style={labelStyle}>Username</label>
            <input
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              style={inputStyle}
              autoFocus
            />
            <label style={labelStyle}>Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              style={inputStyle}
            >
              <option value="staff">Staff</option>
              <option value="admin">Admin</option>
            </select>
          </>
        )}

        {state.mode === 'change-password' && (
          <>
            <label style={labelStyle}>Current Password</label>
            <input
              required
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              style={inputStyle}
            />
          </>
        )}

        <label style={labelStyle}>
          {state.mode === 'create' ? 'Password' : 'New Password'}
        </label>
        <input
          required
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{ ...inputStyle, marginBottom: 20 }}
          autoFocus={state.mode !== 'create'}
        />

        <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 20 }}>
          Min 8 chars · uppercase · lowercase · digit · special character
        </p>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={btnStyle('secondary', true)}>
            Cancel
          </button>
          <button type="submit" disabled={loading} style={btnStyle('primary', true)}>
            {loading ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ────────────────────────────────────────
// Main component
// ────────────────────────────────────────

export function UserManagement({ sessionId, user, addToast }: Props): React.JSX.Element {
  const [users, setUsers] = useState<SafeUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<UserModalState | null>(null);

  const load = useCallback(async () => {
    const res = await window.sccfs.users.list(sessionId);
    if (res.ok) setUsers(res.data);
    else addToast('error', res.error?.message ?? 'Failed to load users');
    setLoading(false);
  }, [sessionId, addToast]);

  useEffect(() => {
    load();
  }, [load]);

  const handleToggleActive = async (u: SafeUser) => {
    const res = await window.sccfs.users.update(sessionId, u.id, { is_active: !u.is_active });
    if (res.ok) {
      addToast('success', `${u.username} ${res.data.is_active ? 'enabled' : 'disabled'}`);
      load();
    } else {
      addToast('error', res.error?.message ?? 'Failed');
    }
  };

  const handleToggleRole = async (u: SafeUser) => {
    const newRole = u.role === 'admin' ? 'staff' : 'admin';
    const res = await window.sccfs.users.update(sessionId, u.id, { role: newRole });
    if (res.ok) {
      addToast('success', `${u.username} role changed to ${newRole}`);
      load();
    } else {
      addToast('error', res.error?.message ?? 'Failed');
    }
  };

  const handleUnlock = async (u: SafeUser) => {
    const res = await window.sccfs.users.unlock(sessionId, u.id);
    if (res.ok) {
      addToast('success', `${u.username} unlocked`);
      load();
    } else {
      addToast('error', res.error?.message ?? 'Failed');
    }
  };

  const handleDelete = async (u: SafeUser) => {
    if (!confirm(`Delete user "${u.username}"? This cannot be undone.`)) return;
    const res = await window.sccfs.users.delete(sessionId, u.id);
    if (res.ok) {
      addToast('success', `User "${u.username}" deleted`);
      load();
    } else {
      addToast('error', res.error?.message ?? 'Failed');
    }
  };

  // Stats for charts
  const adminCount = users.filter((u) => u.role === 'admin').length;
  const staffCount = users.filter((u) => u.role === 'staff').length;
  const activeCount = users.filter((u) => u.is_active).length;
  const inactiveCount = users.filter((u) => !u.is_active).length;

  const roleData = [
    { name: 'Admin', value: adminCount },
    { name: 'Staff', value: staffCount },
  ];
  const statusData = [
    { name: 'Active', value: activeCount },
    { name: 'Inactive', value: inactiveCount },
  ];
  const PIE_COLORS = ['#4f46e5', '#0284c7', '#16a34a', '#dc2626'];

  return (
    <div style={{ padding: 28 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>
            User Management
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
            {users.length} user{users.length !== 1 ? 's' : ''} registered
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => setModal({ mode: 'change-password', userId: user.id, username: user.username })}
            style={btnStyle('secondary')}
          >
            🔑 My Password
          </button>
          <button
            onClick={() => setModal({ mode: 'create' })}
            style={btnStyle('primary')}
          >
            + New User
          </button>
        </div>
      </div>

      {/* Charts row */}
      <div style={{ display: 'flex', gap: 20, marginBottom: 24 }}>
        <div style={{ ...cardStyle(), flex: 1 }}>
          <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--text-primary)' }}>
            Role Distribution
          </h3>
          <ResponsiveContainer width="100%" height={150}>
            <PieChart>
              <Pie
                data={roleData}
                cx="50%"
                cy="50%"
                innerRadius={40}
                outerRadius={60}
                paddingAngle={3}
                dataKey="value"
              >
                {roleData.map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div style={{ ...cardStyle(), flex: 1 }}>
          <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--text-primary)' }}>
            Account Health
          </h3>
          <ResponsiveContainer width="100%" height={150}>
            <PieChart>
              <Pie
                data={statusData}
                cx="50%"
                cy="50%"
                innerRadius={40}
                outerRadius={60}
                paddingAngle={3}
                dataKey="value"
              >
                <Cell fill="#16a34a" />
                <Cell fill="#dc2626" />
              </Pie>
              <Tooltip />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Quick stats */}
        <div style={{ ...cardStyle(), flex: 1 }}>
          <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: 'var(--text-primary)' }}>
            Quick Stats
          </h3>
          {[
            { label: 'Total users', value: users.length },
            { label: 'Active', value: activeCount, color: '#16a34a' },
            { label: 'Inactive', value: inactiveCount, color: '#dc2626' },
            { label: 'Admins', value: adminCount, color: '#4f46e5' },
          ].map((s) => (
            <div
              key={s.label}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '5px 0',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{s.label}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: s.color ?? 'var(--text-primary)' }}>
                {s.value}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Table */}
      <div style={{ ...cardStyle(), padding: 0, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--bg-hover)', borderBottom: '1px solid var(--border)' }}>
              {['Username', 'Role', 'Status', 'Created', 'Actions'].map((h) => (
                <th key={h} style={thStyle()}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', padding: 32, color: 'var(--text-secondary)' }}>
                  Loading…
                </td>
              </tr>
            ) : (
              users.map((u) => {
                const isSelf = u.id === user.id;
                return (
                  <tr key={u.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={tdStyle()}>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                        {u.username}
                        {isSelf && (
                          <span
                            style={{
                              fontSize: 10,
                              background: 'var(--accent)',
                              color: '#fff',
                              borderRadius: 10,
                              padding: '1px 6px',
                              marginLeft: 6,
                            }}
                          >
                            You
                          </span>
                        )}
                      </div>
                    </td>
                    <td style={tdStyle()}>
                      <button
                        onClick={() => !isSelf && handleToggleRole(u)}
                        title={isSelf ? 'Cannot change your own role' : `Switch to ${u.role === 'admin' ? 'staff' : 'admin'}`}
                        style={{
                          fontSize: 11,
                          padding: '3px 8px',
                          borderRadius: 10,
                          border: 'none',
                          background: u.role === 'admin' ? '#eef2ff' : '#f0fdf4',
                          color: u.role === 'admin' ? '#4f46e5' : '#16a34a',
                          cursor: isSelf ? 'default' : 'pointer',
                          fontWeight: 600,
                          textTransform: 'capitalize',
                        }}
                      >
                        {u.role}
                      </button>
                    </td>
                    <td style={tdStyle()}>
                      <button
                        onClick={() => !isSelf && handleToggleActive(u)}
                        title={isSelf ? 'Cannot disable your own account' : `${u.is_active ? 'Disable' : 'Enable'} user`}
                        style={{
                          fontSize: 11,
                          padding: '3px 8px',
                          borderRadius: 10,
                          border: 'none',
                          background: u.is_active ? '#f0fdf4' : '#fef2f2',
                          color: u.is_active ? '#16a34a' : '#dc2626',
                          cursor: isSelf ? 'default' : 'pointer',
                          fontWeight: 600,
                        }}
                      >
                        {u.is_active ? '● Active' : '○ Inactive'}
                      </button>
                    </td>
                    <td style={{ ...tdStyle(), color: 'var(--text-secondary)', fontSize: 12 }}>
                      {new Date(u.created_at).toLocaleDateString()}
                    </td>
                    <td style={tdStyle()}>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        <button
                          onClick={() => setModal({ mode: 'reset-password', userId: u.id, username: u.username })}
                          style={btnStyle('ghost', true)}
                          title="Reset password"
                        >
                          🔑
                        </button>
                        {!u.is_active && (
                          <button
                            onClick={() => handleUnlock(u)}
                            style={btnStyle('ghost', true)}
                            title="Unlock account"
                          >
                            🔓
                          </button>
                        )}
                        {!isSelf && (
                          <button
                            onClick={() => handleDelete(u)}
                            style={{ ...btnStyle('ghost', true), color: 'var(--danger)' }}
                            title="Delete user"
                          >
                            🗑
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {modal && (
        <UserModal
          state={modal}
          sessionId={sessionId}
          addToast={addToast}
          onClose={() => setModal(null)}
          onDone={load}
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
    padding: '10px 16px',
    textAlign: 'left',
    fontSize: 11,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: 'var(--text-secondary)',
  };
}

function tdStyle(): React.CSSProperties {
  return { padding: '12px 16px', fontSize: 13 };
}
