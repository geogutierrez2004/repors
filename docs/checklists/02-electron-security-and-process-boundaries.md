# Electron Security and Process Boundaries Checklist

## BrowserWindow Security
- [x] `contextIsolation: true`
- [x] `nodeIntegration: false`
- [x] `sandbox: true`
- [x] `webSecurity: true`
- [x] `allowRunningInsecureContent: false`

## Preload Contract
- [x] API exposed via `contextBridge.exposeInMainWorld`
- [x] Raw `ipcRenderer` never exposed
- [x] Channel allowlist enforcement
- [x] Return typed responses (IpcResponse envelope)

## IPC Security
- [x] Namespace prefix `sccfs:`
- [x] Payload validation with zod schemas
- [x] Normalized error envelope on every response
- [x] Session verified on every privileged operation

## Process Boundary
- [x] SQLite access only in main process
- [x] No `require('fs')` in renderer
- [x] No `require('crypto')` in renderer
- [x] No `require('better-sqlite3')` in renderer
- [x] Content Security Policy in HTML

## Single Instance
- [x] `app.requestSingleInstanceLock()` prevents multi-instance
