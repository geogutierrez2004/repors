# File Encryption and Key Management Checklist

- [x] AES-256-GCM cipher
- [x] Per-file random salt and IV
- [x] PBKDF2-SHA512 for key derivation
- [x] High iteration count (600,000+)
- [x] Never persist plaintext per-file keys/passwords
- [x] GCM tag mismatch treated as corruption/tamper
- [x] Decryption runs in main process only
- [x] Encrypted download fails safely when encryption metadata is missing
- [x] Streaming encrypt/decrypt is used for large files
- [x] SHA-256 stored in `files.sha256` is the plaintext checksum (pre-encryption)
