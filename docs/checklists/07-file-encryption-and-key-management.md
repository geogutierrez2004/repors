# File Encryption and Key Management Checklist

- [ ] AES-256-GCM cipher
- [ ] Per-file random salt and IV
- [ ] PBKDF2-SHA512 for key derivation
- [ ] High iteration count (600,000+)
- [ ] Never persist plaintext keys
- [ ] GCM tag mismatch treated as corruption/tamper
- [ ] Encrypted file passwords non-recoverable by design
