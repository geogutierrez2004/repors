# Data Model and IPC Contracts Checklist

## Database Schema
- [x] `users` table with role, lockout, and active fields
- [x] `shelves` table with system flag
- [x] `files` table with checksum and encryption flag
- [x] `upload_history` table
- [x] `downloads` table
- [x] `activity_log` table
- [x] `storage_config` table
- [x] `encryption_keys` table
- [x] `app_config` table
- [x] Migration tracking table

## IPC Contracts
- [x] Namespace prefix: `sccfs:`
- [x] Pattern: `domain:verb`
- [x] Uniform response envelope (`ok`, `data`, `error`)
- [x] Zod schema validation on all payloads
- [x] Channel allowlist in preload
