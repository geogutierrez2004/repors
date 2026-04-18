# User's Manual

## 1. Getting Started
1. Launch the application.
2. Sign in with your assigned account credentials.
3. After login, use the left navigation to open Dashboard, File Browser, Activity Log, Security, or Storage & Backup.

## 2. File Browser
### 2.1 Browse and Filter Files
1. Open File Browser.
2. Select a folder from the left panel.
3. Use Search to narrow the file list.

### 2.2 Upload Files
1. Select a folder.
2. Click Upload.
3. Enter and confirm the encryption password when prompted.
4. Wait for upload completion and review success/error toasts.

### 2.3 Download Files
1. Click Download for the target file.
2. If encrypted, enter the decryption password.
3. Choose save destination in the system file dialog.

### 2.4 Secure In-app Viewer
1. Click View on encrypted files.
2. Enter decryption password.
3. Use in-modal controls for PDF page navigation and link preview.
4. Note shown in viewer: preview may differ from downloaded original file format.

### 2.5 Move or Delete Files
1. Select one or more files.
2. Use Move to choose destination folder.
3. Use Delete to remove selected files.

## 3. Activity Log
1. Open Activity Log.
2. Filter by action and date range.
3. Export CSV to download complete activity history.
4. Use Print for paper/PDF reporting.

## 4. Security Dashboard
### 4.1 Integrity Metrics
1. Review cards for encryption coverage, failed uploads, storage risk, backup freshness, and auth threat events.

### 4.2 Configure Threshold Settings
1. In Security Dashboard, open Security Severity Thresholds.
2. Set values for:
- Storage warning percent
- Storage danger percent
- Upload failures warning (24h)
- Upload failures danger (24h)
3. Click Save Thresholds.
4. Use Reset Defaults to restore baseline values before saving.

### 4.3 Access Controls
1. Review active sessions.
2. Terminate non-current sessions if needed.
3. Change password and confirm policy compliance.

## 5. Storage & Backup
1. Open Storage & Backup.
2. Monitor used space, trend, and storage by folder.
3. Click Backup to create a backup package.
4. Click Restore to restore from a selected backup.

## 6. Common Warnings
1. Storage warning: usage approaching configured threshold.
2. Storage critical: usage at/above danger threshold.
3. Failed uploads warning: 24h failures exceed configured level.

## 7. Troubleshooting
1. Build/runtime issues after updates: run main and renderer build commands.
2. Cannot decrypt file: verify password and file integrity.
3. Session invalid errors: log in again.
4. Restore caution: restore may invalidate active sessions.
