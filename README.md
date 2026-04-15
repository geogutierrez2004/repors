# St. Clare College Filing System (SCCFS)

A local-first desktop filing application for registrar operations built with Electron, React, and SQLite.

## Stack

- **Electron 32.x** – desktop application shell
- **Node.js 20 LTS** – runtime
- **React 18** – renderer UI
- **SQLite (better-sqlite3)** – local database
- **TypeScript** – language for all process boundaries
- **Zod** – IPC payload validation

## Architecture

| Process | Responsibility |
|---|---|
| Main | SQLite access, filesystem I/O, encryption, IPC handlers, session/RBAC enforcement |
| Preload | Constrained `contextBridge` API (`window.sccfs`) |
| Renderer | React UI only; calls preload API, never Node APIs |

## Getting Started

```bash
npm install
npm test          # Run unit + integration tests
npm run build     # Compile TypeScript
npm start         # Launch Electron app
```

## Project Structure

```
src/
├── main/           # Electron main process
│   ├── database/   # SQLite connection and migrations
│   ├── ipc/        # IPC handlers and validators
│   ├── services/   # Auth, session, RBAC services
│   └── utils/      # Password hashing utilities
├── preload/        # contextBridge preload script
├── renderer/       # React UI (login page)
└── shared/         # Types, constants, IPC channel definitions
tests/
└── unit/           # Unit and integration tests
docs/
└── checklists/     # Implementation requirement checklists
```

## Security

- `contextIsolation: true`, `nodeIntegration: false`, renderer sandbox enabled
- IPC channel allowlist and zod schema validation
- Argon2id password hashing (scrypt fallback)
- Session inactivity timeout (30 min) and absolute expiration (8 hr)
- Account lockout after 5 failed attempts
- Role-based access control on every privileged operation
