# Authentication and Single-User Security Checklist

## Password Policy
- [x] Minimum length 8 characters
- [x] Maximum length 128 characters
- [x] Require uppercase letter
- [x] Require lowercase letter
- [x] Require digit
- [x] Require special character
- [x] Policy enforced in main process

## Password Hashing
- [x] Argon2id preferred (with scrypt fallback)
- [x] Unique salt per hash
- [x] Timing-safe comparison

## Login
- [x] Username case-insensitive lookup
- [x] Generic error message on invalid credentials
- [x] Account lockout after 5 failed attempts
- [x] 15-minute lockout duration
- [x] Reset failed attempts on successful login
- [x] Reject login for disabled accounts

## Session Management
- [x] UUID-based session IDs
- [x] In-memory session map
- [x] 30-minute inactivity timeout
- [x] 8-hour absolute session expiration
- [x] Refresh last activity on validated access
- [x] Destroy session on logout
- [x] Destroy all sessions when user is deactivated

## Authorization Model (Single User)
- [x] Authenticated session required for privileged operations
- [x] No role-based permission matrix
- [x] No multi-user administration flows
- [x] Password hash never sent to renderer

## Destructive Action Safeguards
- [x] Confirmation prompts for destructive operations
- [x] Self-session termination blocked from security dashboard
- [x] Sessions invalidated after restore

## Activity Logging
- [x] Log login events
- [x] Log logout events
- [x] Log password changes
- [x] Log session termination operations
- [x] Log account lockouts
