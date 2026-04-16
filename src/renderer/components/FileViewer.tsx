import React, { useEffect, useMemo, useState } from 'react';
import DOMPurify from 'dompurify';
import { Document, Page } from 'react-pdf';
import type { FilePreviewData } from '../../shared/types';
import { btnStyle, cardStyle } from '../App';

interface FileViewerProps {
  sessionId: string;
  fileId: string;
  fileName: string;
  mimeType: string | null;
  isEncrypted: boolean;
  onClose: () => void;
}

function decodeBase64(contentBase64: string): Uint8Array {
  const binary = atob(contentBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function FileViewer({
  sessionId,
  fileId,
  fileName,
  mimeType,
  isEncrypted,
  onClose,
}: FileViewerProps): React.JSX.Element {
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [preview, setPreview] = useState<FilePreviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pdfPages, setPdfPages] = useState(1);

  const clearViewerState = () => {
    setPassword('');
    setPasswordError(null);
    setPreview(null);
    setLoading(false);
    setError(null);
    setPdfPages(1);
  };

  const closeViewer = () => {
    clearViewerState();
    onClose();
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeViewer();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      clearViewerState();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadPreview = async (decryptionPassword?: string) => {
    setLoading(true);
    setError(null);
    const res = await window.sccfs.files.getPreview(sessionId, fileId, decryptionPassword);
    setLoading(false);
    if (!res.ok) {
      if (res.error?.code === 'DECRYPTION_FAILED_AUTH_TAG') {
        setError('Corrupted file');
      } else {
        setError(res.error?.message ?? 'Preview failed');
      }
      return;
    }
    setPreview(res.data);
  };

  useEffect(() => {
    if (isEncrypted) return;
    void loadPreview();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId, isEncrypted]);

  const htmlForIframe = useMemo(() => {
    if (!preview || preview.classification.renderer !== 'html') return '';
    const html = new TextDecoder().decode(decodeBase64(preview.fileContent));
    return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
  }, [preview]);

  const textContent = useMemo(() => {
    if (!preview || preview.classification.renderer !== 'text') return '';
    return new TextDecoder().decode(decodeBase64(preview.fileContent));
  }, [preview]);

  const imageDataUrl = useMemo(() => {
    if (!preview || preview.classification.renderer !== 'image') return '';
    const useMime = preview.mimeType ?? mimeType ?? 'application/octet-stream';
    return `data:${useMime};base64,${preview.fileContent}`;
  }, [preview, mimeType]);

  const handleDownload = async () => {
    let decryptionPassword = password.trim();
    if (isEncrypted && !decryptionPassword) {
      decryptionPassword = window.prompt('Enter decryption password to download this file')?.trim() ?? '';
      if (!decryptionPassword) return;
    }
    const res = await window.sccfs.files.download(sessionId, fileId, decryptionPassword || undefined);
    if (!res.ok && res.error?.code !== 'CANCELLED') {
      setError(res.error?.code === 'DECRYPTION_FAILED_AUTH_TAG' ? 'Corrupted file' : (res.error?.message ?? 'Download failed'));
    }
  };

  const renderContent = () => {
    if (!preview) return null;
    if (preview.classification.category === 'unsupported') {
      return (
        <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
          File type not supported for preview. Download instead?
        </div>
      );
    }
    if (preview.classification.renderer === 'pdf') {
      return (
        <Document
          file={{ data: decodeBase64(preview.fileContent) }}
          options={{ disableWorker: true }}
          onLoadSuccess={({ numPages }) => setPdfPages(numPages)}
          onLoadError={() => setError('Viewer failed to render PDF. Download instead.')}
        >
          {Array.from({ length: pdfPages }).map((_, index) => (
            <Page key={index + 1} pageNumber={index + 1} width={720} />
          ))}
        </Document>
      );
    }
    if (preview.classification.renderer === 'image') {
      return <img alt={preview.fileName} src={imageDataUrl} style={{ maxWidth: '100%', maxHeight: '65vh' }} />;
    }
    if (preview.classification.renderer === 'text') {
      return <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{textContent}</pre>;
    }
    if (preview.classification.renderer === 'html') {
      return (
        <iframe
          title={preview.fileName}
          sandbox=""
          srcDoc={htmlForIframe}
          style={{ border: 0, width: '100%', height: '65vh' }}
        />
      );
    }
    return (
      <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
        File type not supported for preview. Download instead?
      </div>
    );
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1200,
      }}
    >
      <div style={{ ...cardStyle(), width: 'min(960px, 96vw)', maxHeight: '90vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <h3 style={{ margin: 0 }}>File Viewer</h3>
          <button onClick={closeViewer} style={btnStyle('secondary', true)}>Close</button>
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-secondary)' }}>{fileName}</div>
        {isEncrypted && !preview && !loading && (
          <div style={{ marginTop: 12 }}>
            <p style={{ margin: 0, marginBottom: 8, color: 'var(--text-secondary)', fontSize: 13 }}>
              Enter password to decrypt preview.
            </p>
            <input
              type="password"
              autoFocus
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setPasswordError(null);
              }}
              placeholder="Decryption password"
              style={modalInputStyle}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  const value = password.trim();
                  if (!value) {
                    setPasswordError('Password is required.');
                    return;
                  }
                  void loadPreview(value);
                }
              }}
            />
            {passwordError && <div style={{ marginTop: 8, color: 'var(--danger)', fontSize: 12 }}>{passwordError}</div>}
            <div style={{ marginTop: 10 }}>
              <button
                style={btnStyle('primary', true)}
                onClick={() => {
                  const value = password.trim();
                  if (!value) {
                    setPasswordError('Password is required.');
                    return;
                  }
                  void loadPreview(value);
                }}
              >
                Preview
              </button>
            </div>
          </div>
        )}
        {loading && <div style={{ marginTop: 16, color: 'var(--text-secondary)' }}>Loading preview...</div>}
        {error && <div style={{ marginTop: 16, color: 'var(--danger)' }}>{error}</div>}
        {!loading && preview && (
          <>
            {preview.note && (
              <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-secondary)' }}>{preview.note}</div>
            )}
            <div style={{ marginTop: 14, border: '1px solid var(--border)', borderRadius: 6, padding: 10 }}>
              {renderContent()}
            </div>
          </>
        )}
        {(error || preview?.classification.category === 'unsupported') && (
          <div style={{ marginTop: 12 }}>
            <button onClick={() => void handleDownload()} style={btnStyle('ghost', true)}>
              Download
            </button>
          </div>
        )}
      </div>
    </div>
  );
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
