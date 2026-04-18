# Program Listing

## Overview
This document lists the major program modules and key responsibilities for the St. Clare College Filing System.

## Main Process Modules
1. src/main/index.ts: Electron app bootstrap, handler registration, and lifecycle wiring.
2. src/main/window.ts: Main BrowserWindow configuration and navigation hardening.
3. src/main/database/index.ts: Migration runner and schema setup.
4. src/main/database/migrations/*.ts: Incremental schema evolution and data updates.
5. src/main/ipc/auth.handler.ts: Authentication IPC endpoints.
6. src/main/ipc/dashboard.handler.ts: Dashboard, files, activity, storage, and session IPC endpoints.
7. src/main/ipc/validators.ts: Zod schemas for IPC payload validation.
8. src/main/services/auth.service.ts: Login/logout/password and single-user account controls.
9. src/main/services/dashboard.service.ts: Core business logic for files, activity, storage, backup/restore, and security integrity stats.
10. src/main/services/rbac.service.ts: Role-based access checks.
11. src/main/services/session.service.ts: In-memory session management.
12. src/main/restore/hot-swap.ts: Restore execution and state transition behavior.

## Preload and Shared Contracts
1. src/preload/index.ts: Context bridge API exposed to renderer.
2. src/shared/ipc-channels.ts: Allowed IPC channel constants.
3. src/shared/types.ts: Shared domain models and API payload contracts.
4. src/shared/constants.ts: Global constants and enum-like settings.

## Renderer Modules
1. src/renderer/App.tsx: Shell, navigation, and page routing.
2. src/renderer/pages/Dashboard.tsx: Summary dashboard and operational overview.
3. src/renderer/pages/FileBrowser.tsx: Upload/download/preview/folder operations.
4. src/renderer/pages/ActivityLog.tsx: Audit list, filters, print/export.
5. src/renderer/pages/SecurityDashboard.tsx: Integrity metrics, access controls, and threshold settings.
6. src/renderer/pages/StorageBackup.tsx: Quota, trend, backup, and restore workflows.
7. src/renderer/pages/UserManagement.tsx: Single-user profile/admin controls.
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
