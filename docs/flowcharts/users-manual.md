# User's Manual

## 1. Getting Started
1. Launch the application.
2. Sign in with your assigned account credentials.
3. After login, use the left navigation to open Dashboard, File Browser, Activity Log, Security, or Storage & Backup.
4. **Admin vs Staff Access**: 
   - Admins can upload, download, rename, move, and delete files and folders. They also see all activity logs and have access to user management and security settings.
   - Staff users have view-only access to files and can download files, but cannot upload, rename, move, or delete files and folders. They see only their own activity in the recent activity feed.

## 2. File Browser
### 2.1 Browse and Filter Files
1. Open File Browser.
2. Select a folder from the left panel.
3. Use Search to narrow the file list.

### 2.2 Upload Files
1. Select a folder.
2. Click Upload or drag and drop files into the file browser area.
3. If uploading multiple files, review the batch summary modal showing all files to be uploaded.
4. Enter and confirm the encryption password when prompted.
5. Wait for upload completion and review success/error toasts.
**Note:** Only admins can upload files. Staff users have view-only access.

### 2.3 Download Files
1. Click Download for the target file.
2. If encrypted, enter the decryption password.
3. Choose save destination in the system file dialog.

### 2.4 Secure In-app Viewer
1. Click View on encrypted files.
2. Enter decryption password.
3. Use in-modal controls for PDF page navigation and link preview.
4. Note shown in viewer: preview may differ from downloaded original file format.

### 2.5 Manage Files (Rename, Move, Delete)
1. Select one or more files.
2. Use the action buttons in the file row:
   - **Rename**: Click the ✏ button to rename the selected file.
   - **Move**: Click the 📂 button to move the file to a different folder.
   - **Delete**: Click the 🗑 button to delete the file (admin only).
3. For folder deletion: right-click or use the × button on the folder.
   - If the folder is empty, it deletes immediately.
   - If the folder contains files, you will be prompted to create a new folder and choose to move the files there.
4. After operations, the file list updates automatically.

**Note:** File rename, move, and delete operations require admin privileges. Staff users can view files but cannot modify them.

## 2.6 File Table Information
The file browser displays the following columns:
- **Name**: Original filename
- **Size**: File size in human-readable format
- **Enc.**: Encryption status (✓ = encrypted, — = plain)
- **Uploaded**: Date and time the file was uploaded
- **By**: Username of the person who uploaded the file (or "system" for files uploaded before user attribution was enabled)
- **Actions**: Buttons for preview, move, rename, and delete operations

## 3. Activity Log
1. Open Activity Log.
2. Filter by action and date range.
3. The activity log displays:
   - **Timestamp**: When the action occurred
   - **User**: Username of the person who performed the action
   - **Action**: Type of operation (e.g., File Upload, File Delete, Folder Create)
   - **Detail**: Human-readable description of what was done
4. Export CSV to download complete activity history (includes usernames).
5. Use Print for paper/PDF reporting.
6. The activity heatmap shows event frequency across days and 4-hour time buckets.

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
