# Program Listing

## Overview
This document lists the major program modules and key responsibilities for the St. Clare College Filing System.

## Main Process Modules
1. src/main/index.ts: Electron app bootstrap, handler registration, and lifecycle wiring.
2. src/main/window.ts: Main BrowserWindow configuration, maximized window mode, and navigation hardening.
3. src/main/database/index.ts: Migration runner and schema setup with seeding flag support.
4. src/main/database/migrations/*.ts: Incremental schema evolution and data updates (including 005-add-seeding-flag).
5. src/main/ipc/auth.handler.ts: Authentication IPC endpoints with audit logging.
6. src/main/ipc/dashboard.handler.ts: Dashboard, files, activity, storage, session, and file management IPC endpoints.
7. src/main/ipc/validators.ts: Zod schemas for IPC payload validation (including FILE_RENAME, SHELVES_CHECK_CONTENTS).
8. src/main/services/auth.service.ts: Login/logout/password, single-user account controls, and audit logging (logAudit method).
9. src/main/services/dashboard.service.ts: Core business logic for files, activity, storage, backup/restore, security integrity stats, and comprehensive audit logging for file operations (rename, move, delete).
10. src/main/services/rbac.service.ts: Role-based access checks.
11. src/main/services/session.service.ts: In-memory session management.
12. src/main/restore/hot-swap.ts: Restore execution and state transition behavior.
13. src/main/services/container.ts: Service initialization and dependency injection.

## Preload and Shared Contracts
1. src/preload/index.ts: Context bridge API exposed to renderer.
2. src/shared/ipc-channels.ts: Allowed IPC channel constants.
3. src/shared/types.ts: Shared domain models and API payload contracts.
4. src/shared/constants.ts: Global constants and enum-like settings.

## Renderer Modules
1. src/renderer/App.tsx: Shell, navigation, and page routing with role-based nav item filtering.
2. src/renderer/pages/Dashboard.tsx: Summary dashboard with role-based KPI visibility (admins see active sessions and locked accounts), operational overview, and drive status alerts.
3. src/renderer/pages/FileBrowser.tsx: Upload (dialog and drag-drop), download, preview, folder operations, and file management (rename, move, delete) with modals for batch uploads, folder content handling, and delete confirmations. Staff users see view-only mode with disabled operations.
4. src/renderer/pages/ActivityLog.tsx: Audit list with username column, filters, natural-language action names, activity heatmap, and print/export with user attribution.
5. src/renderer/pages/SecurityDashboard.tsx: Integrity metrics (admin-only), active sessions table (admin-only), and threshold settings for severity mapping.
6. src/renderer/pages/StorageBackup.tsx: Quota, trend (in MB), storage by folder, backup, and restore workflows with improved chart formatting.
7. src/renderer/pages/UserManagement.tsx: Single-user profile/admin controls with role-based unlock button visibility.
8. src/renderer/utils/document-preview.ts: MIME inference and conversion helpers.

## Test Modules
1. tests/unit/auth.service.test.ts: Authentication flows and constraints.
2. tests/unit/dashboard.service.test.ts: File pipeline, encryption/decryption, and service behavior.
3. tests/unit/password.test.ts: Password policy and hashing helpers.
4. tests/unit/hot-swap-restore.test.ts: Restore behavior and safety checks.
5. tests/unit/document-preview.test.ts: Preview conversion and MIME handling.

## Security Threshold Settings Listing
1. Settings model: src/shared/types.ts (SecurityThresholdSettings).
2. IPC channels: src/shared/ipc-channels.ts (security threshold get/set).
3. Main validation and handlers: src/main/ipc/validators.ts and src/main/ipc/dashboard.handler.ts.
4. Persistence logic: src/main/services/dashboard.service.ts (app_config key: security_threshold_settings).
5. UI controls: src/renderer/pages/SecurityDashboard.tsx.
