# DFD Level 1

[User]
  ├──▶ (Credentials) ──▶ ╔══════════════════════╗
  │                      ║ 1. Authenticate User ║
  │                      ╚══════════════════════╝
  │                                 │
  │                                 ├──▶ (Auth Result) ──▶ ╔════════════════════╗
  │                                 │                      ║ 2. Validate Access ║
  │                                 │                      ╚════════════════════╝
  │                                 │                                 │
  │                                 │                                 ├──▶ (Permitted Action) ──▶ ╔════════════════════╗
  │                                 │                                 │                           ║ 3. Manage Files    ║
  │                                 │                                 │                           ╚════════════════════╝
  │                                 │                                 │                                      │
  │                                 │                                 │                                      ├──▶ (Upload/Download) ──▶ [API]
  │                                 │                                 │                                      └──▶ (File Metadata) ──▶ 🗄️ File Store
  │                                 │                                 │
  │                                 │                                 └──▶ (Access Event) ──▶ 🗄️ Audit Log Store
  │                                 │
  │                                 └──▶ (User Record Query) ──▶ 🗄️ User Store
  │
  └──▶ (Dashboard Request) ──▶ ╔══════════════════════╗ ──▶ (Metrics / Reports) ──▶ [User]
                               ║ 4. Generate Dashboard║
                               ╚══════════════════════╝
                                           │
                                           └──▶ (Read Metrics) ──▶ 🗄️ Audit Log Store

[API] ──▶ (External Data) ──▶ ╔════════════════════╗ ──▶ (Synced Data) ──▶ 🗄️ File Store
                              ║ 5. Sync API Data   ║
                              ╚════════════════════╝

[DB] ◀── (Backup / Restore Streams) ◀── ╔════════════════════╗
                                         ║ 3. Manage Files    ║
                                         ╚════════════════════╝

