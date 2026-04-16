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

### Prerequisites
- **Node.js 20 LTS** or higher
- **npm** or **yarn**
- Windows, macOS, or Linux

### Quick Setup

```bash
# 1. Clone the repository
git clone https://github.com/geogutierrez2004/repors.git
cd repors

# 2. Install dependencies (postinstall will auto-run electron-rebuild)
npm install

# 3. Run tests to verify everything works
npm test

# 4. Build and start the app
npm start
```

### Default Credentials

On first launch, the app automatically creates a default admin account:
- **Username:** `fs_adm1`
- **Password:** `M0n$p33t101`

Delete the database file to reset credentials:
```bash
# Windows
Remove-Item $env:APPDATA\sccfs\data\sccfs.db -Force

# macOS/Linux
rm ~/.config/sccfs/data/sccfs.db
```

### Troubleshooting

**Native Module Errors?**
The `postinstall` script automatically rebuilds native modules (`better-sqlite3`, `argon2`) for Electron. If you still encounter errors, manually rebuild:
```bash
npm run postinstall
```

**Tests Failing?**
Ensure `npm rebuild` completed successfully after `npm install`.

**App Won't Start?**
Delete the database and rebuild:
```bash
npm run postinstall
npm start
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

## Encrypted Upload/Download Notes

- Upload supports standard and AES-256-GCM encrypted storage.
- Encrypted files use per-file salt + IV + auth tag with PBKDF2-SHA512 key derivation (600,000 iterations).
- Decryption is performed only in the Electron main process during download.
- If encrypted metadata is missing or the auth tag fails validation, download fails with a corruption/integrity error.
- `files.sha256` stores the plaintext checksum (computed from the original file bytes before encryption).
- Non-encrypted payload deduplication is enabled to reduce duplicate disk usage; encrypted uploads do not deduplicate.
