# Storage Quota, Backup, Restore, and Network Storage Checklist

## Storage Quota and Local Storage

- [ ] Quota calculated from active file records
- [ ] Default quota: 500 GB logical
- [ ] Quota enforcement on upload
- [ ] SQLite checkpoint before backup
- [ ] Use `db.backup()` API for safe backup
- [ ] Restore: close DB → swap data → reopen → relaunch
- [ ] Backup/restore operations admin-only

## Network Storage Configuration

### Setup

- [ ] Network path configured as UNC format: `\\server\share`
- [ ] Network path must be on Windows file share or SMB-compatible system
- [ ] Network path accessibility verified with test connection
- [ ] Network path enabled in NetworkStorage settings page
- [ ] Encryption password shared across all devices accessing network storage
- [ ] Appropriate file sharing permissions set on network share

### Configuration Management

- [ ] Network settings stored in `network_settings` database table
- [ ] Settings include: network path, enabled flag, created_at, updated_at
- [ ] Only one active network path at a time (latest config wins)
- [ ] Network path changes are logged in activity_log as `NETWORK_PATH_SET`

### Security

- [ ] All files encrypted before uploading to network storage (AES-256-GCM)
- [ ] Encryption keys derived from shared password using PBKDF2-SHA512
- [ ] Files remain encrypted at all times on network share
- [ ] Each device decrypts files locally as needed
- [ ] Network access credentials managed by Windows file sharing permissions
- [ ] Filenames visible but content encrypted
- [ ] Encryption password never stored; derived on-demand from user input

### File Movement Operations

- [ ] Files can be moved from local to network storage via FileBrowser UI
- [ ] Files can be moved from network back to local storage
- [ ] File movement operations are atomic: copy, update DB, delete original
- [ ] Storage location tracked in `files.storage_location` column ('local' | 'network')
- [ ] Sync metadata tracked: `synced_at` (when synced), `sync_error` (if failed)
- [ ] File payloads storage location tracked in `file_payloads.storage_location`
- [ ] Movement operations logged in activity_log as `FILE_MOVED_TO_NETWORK` or `FILE_MOVED_TO_LOCAL`

### Network File Syncing

- [ ] NetworkSyncService provides periodic scanning of network storage
- [ ] Default sync interval: 30 seconds (configurable)
- [ ] Sync detects new files on network share not yet in local DB
- [ ] Sync validates file integrity against SHA256 hash
- [ ] Failed sync operations recorded in `sync_error` field
- [ ] Network unavailability gracefully skips sync cycle

### Multi-Device Access

- [ ] Multiple devices can share same network path and encryption password
- [ ] Shelves (folders) are shared across all devices
- [ ] File metadata synchronized via shared database (requires alternative sync mechanism - currently LAN-only)
- [ ] Last-write-wins for concurrent modifications (no advanced conflict resolution)
- [ ] Each device maintains local copy of metadata in SQLite
- [ ] Recommendation: schedule periodic data syncs between devices

### Data Integrity

- [ ] SHA256 hashes verify file integrity on network storage
- [ ] File payloads reference counted for deduplication
- [ ] Encryption auth tags validate decryption success
- [ ] Corrupted files detected during decryption
- [ ] Sync errors quarantine files until resolution

## UNC Path Examples

Valid network paths:
- `\\192.168.1.100\shared_storage` (IP-based)
- `\\nas-server\media_archive` (hostname-based)
- `\\workgroup\documents` (workgroup share)

Invalid paths:
- `C:\local\folder` (local path)
- `/unix/nfs/mount` (Unix path)
- `server\share` (missing double backslash prefix)
- `https://cloud.example.com/storage` (not a local network share)

## Storage Layout on Network

When network storage is configured, files are stored in:
```
\\server\share/network/sccfs/files/
  ├── [uuid-1]-ext (encrypted payload 1)
  ├── [uuid-2]-ext (encrypted payload 2)
  └── ...
```

Each UUID-named file contains the encrypted file payload. Original filenames and metadata are stored in the local SQLite database.

## Future Enhancements

- [ ] Real-time bi-directional sync for shared metadata
- [ ] Conflict resolution strategies beyond last-write-wins
- [ ] Bandwidth throttling for large network transfers
- [ ] File versioning and rollback support
- [ ] Cloud storage provider support (e.g., OneDrive, Google Drive)
- [ ] Compression support for network transfer optimization
- [ ] Partial file sync for bandwidth-limited connections
