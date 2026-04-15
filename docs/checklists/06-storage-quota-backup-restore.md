# Storage Quota, Backup, and Restore Checklist

- [ ] Quota calculated from active file records
- [ ] Default quota: 500 GB logical
- [ ] Quota enforcement on upload
- [ ] SQLite checkpoint before backup
- [ ] Use `db.backup()` API for safe backup
- [ ] Restore: close DB → swap data → reopen → relaunch
- [ ] Backup/restore operations admin-only
