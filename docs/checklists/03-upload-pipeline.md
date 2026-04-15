# Upload Pipeline Checklist

- [ ] Validate file existence before upload
- [ ] Validate file size (max 2 GB)
- [ ] Validate storage quota before accepting
- [ ] Validate MIME type
- [ ] Sanitize filename
- [ ] Check free disk headroom
- [ ] Stream file writes (no full-file memory buffering)
- [ ] Compute and persist SHA-256 checksum
- [ ] Emit progress events from main to renderer
- [ ] Record upload history
