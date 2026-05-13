/**
 * Network Sharing Configuration page.
 *
 * Shows how to share the local sccfs folder for access from other devices on the network.
 */
import React, { useEffect, useState } from 'react';
import type { SafeUser } from '../../shared/types';
import type { AddToast } from '../App';
import { cardStyle, btnStyle } from '../App';

interface Props {
  sessionId: string;
  user: SafeUser;
  addToast: AddToast;
}

// ────────────────────────────────────────
// Utility styles
// ────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--text-secondary)',
  marginBottom: 6,
};

const codeBlockStyle: React.CSSProperties = {
  display: 'block',
  background: 'var(--bg-secondary)',
  padding: 12,
  borderRadius: 4,
  fontSize: 12,
  color: 'var(--text-primary)',
  fontFamily: 'monospace',
  wordBreak: 'break-all',
  marginBottom: 12,
  border: '1px solid var(--border-color)',
};

// ────────────────────────────────────────
// Main Network Sharing Component
// ────────────────────────────────────────

export default function NetworkStorage({ sessionId, user, addToast }: Props): React.ReactElement {
  const [scsfsFolderPath, setScsfsFolderPath] = useState<string | null>(null);
  const [computerName, setComputerName] = useState<string | null>(null);
  const [hostIp, setHostIp] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load system info on mount
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setError(null);

        // Get the sccfs folder path and system info from the app
        const pathRes = await window.sccfs?.storage?.getStoragePath?.(sessionId);
        if (pathRes?.ok) {
          setScsfsFolderPath(pathRes.data.path);
        }

        const hostRes = await window.sccfs?.network?.getHostIp?.();
        if (hostRes?.ok) {
          setHostIp(hostRes.data.hostIp);
          setComputerName(hostRes.data.hostname);
        }

        setLoading(false);
      } catch (e) {
        setLoading(false);
        const errorMsg = e instanceof Error ? e.message : 'Failed to load system info';
        setError(errorMsg);
        addToast('error', errorMsg);
      }
    })();
  }, [sessionId, addToast]);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    addToast('success', 'Copied to clipboard');
  };

  return (
    <div style={{ padding: 20 }}>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>
          Network Sharing
        </h2>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          Share your encrypted file storage with other devices on your network (WiFi or wired).
        </p>
      </div>

      {loading ? (
        <div style={{ ...cardStyle(), textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>
          Loading system information...
        </div>
      ) : error ? (
        <div style={{ ...cardStyle(), background: '#ff4d4f1a', borderLeft: '4px solid #ff4d4f', padding: 16 }}>
          <p style={{ fontSize: 13, color: '#ff4d4f', margin: 0 }}>Error: {error}</p>
        </div>
      ) : (
        <>
          {/* Local Storage Folder Section */}
          <div style={{ ...cardStyle(), marginBottom: 20 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>
              📁 Your Storage Folder
            </h3>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>
              All encrypted files are stored locally in this folder:
            </p>
            <div style={codeBlockStyle}>{scsfsFolderPath || 'Loading...'}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {scsfsFolderPath && (
                <button
                  onClick={async () => {
                    const res = await window.sccfs.storage.openStorageFolder(sessionId);
                    if (res?.ok) addToast('success', 'Opened storage folder');
                    else addToast('error', res?.error?.message ?? 'Failed to open folder');
                  }}
                  style={btnStyle('secondary')}
                >
                  📂 Open Folder
                </button>
              )}
            </div>
          </div>

          {/* Share Instructions Section */}
          <div style={{ ...cardStyle(), marginBottom: 20 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>
              Share This Folder
            </h3>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>
              Follow these steps to share your encrypted file storage with other devices:
            </p>

            <div style={{ marginBottom: 12, display: 'flex', gap: 8 }}>
              <button
                onClick={async () => {
                  try {
                    const res = await window.sccfs.storage.createShare(sessionId);
                    if (res?.ok) {
                      addToast('success', `Share created: ${res.data.uncPath}`);
                    } else {
                      addToast('error', res?.error?.message ?? 'Failed to create share');
                    }
                  } catch (e) {
                    addToast('error', e instanceof Error ? e.message : String(e));
                  }
                }}
                style={btnStyle('primary')}
              >
                🔧 Create Network Share
              </button>

              <button
                onClick={async () => {
                  try {
                    const res = await window.sccfs.storage.removeShare(sessionId);
                    if (res?.ok) addToast('success', 'Share removed');
                    else addToast('error', res?.error?.message ?? 'Failed to remove share');
                  } catch (e) {
                    addToast('error', e instanceof Error ? e.message : String(e));
                  }
                }}
                style={btnStyle('secondary')}
              >
                🗑 Remove Share
              </button>
            </div>

            <ol style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.8, marginBottom: 16 }}>
              <li style={{ marginBottom: 10 }}>
                <strong>Open File Explorer</strong> and navigate to the folder above
              </li>
              <li style={{ marginBottom: 10 }}>
                <strong>Right-click</strong> on the <code style={{ background: 'var(--bg-secondary)', padding: '2px 6px', borderRadius: 3 }}>sccfs</code> folder
              </li>
              <li style={{ marginBottom: 10 }}>
                Select <strong>Properties</strong> → <strong>Sharing</strong> tab
              </li>
              <li style={{ marginBottom: 10 }}>
                Click <strong>Share</strong> and add users (or select "Everyone" for all LAN users)
              </li>
              <li style={{ marginBottom: 10 }}>
                Set permission level to <strong>Read/Write</strong>
              </li>
              <li>
                Click <strong>Share</strong> to apply
              </li>
            </ol>

            <p style={{ fontSize: 11, color: 'var(--text-secondary)', background: 'var(--bg-secondary)', padding: 12, borderRadius: 4, marginBottom: 0 }}>
              <strong>💡 Tip:</strong> Make sure your Windows Firewall allows file sharing. Go to Settings → Network & Internet → Advanced network settings → Windows Defender Firewall → Allow an app through firewall, and enable "File and Printer Sharing" for your network.
            </p>
          </div>

          {/* Connection Paths Section */}
          {/* Connection paths and remote-device instructions removed as requested */}

          {/* How Other Devices Connect Section */}
          {/* Remote-device connection instructions removed as requested */}
        </>
      )}
    </div>
  );
}
