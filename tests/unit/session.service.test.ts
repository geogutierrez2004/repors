/**
 * Unit tests for session management service.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  createSession,
  validateSession,
  destroySession,
  destroyUserSessions,
  getSessionCount,
  clearAllSessions,
} from '../../src/main/services/session.service';
import { Role, AUTH_CONSTANTS } from '../../src/shared/constants';

describe('SessionService', () => {
  beforeEach(() => {
    clearAllSessions();
  });

  it('should create a session with a valid uuid', () => {
    const session = createSession('user-1', Role.ADMIN);
    expect(session.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(session.userId).toBe('user-1');
    expect(session.role).toBe(Role.ADMIN);
    expect(getSessionCount()).toBe(1);
  });

  it('should validate an existing active session', () => {
    const created = createSession('user-1', Role.STAFF);
    const validated = validateSession(created.sessionId);
    expect(validated).not.toBeNull();
    expect(validated!.userId).toBe('user-1');
  });

  it('should return null for an unknown session id', () => {
    const result = validateSession('00000000-0000-4000-a000-000000000000');
    expect(result).toBeNull();
  });

  it('should expire a session after absolute expiry', () => {
    const session = createSession('user-1', Role.ADMIN);
    // Manually backdate creation time beyond absolute expiry
    session.createdAt = Date.now() - AUTH_CONSTANTS.SESSION_ABSOLUTE_EXPIRY_MS - 1;
    session.lastActivity = Date.now(); // keep last activity recent

    const result = validateSession(session.sessionId);
    expect(result).toBeNull();
    expect(getSessionCount()).toBe(0);
  });

  it('should expire a session after inactivity timeout', () => {
    const session = createSession('user-1', Role.STAFF);
    // Manually backdate last activity beyond inactivity timeout
    session.lastActivity = Date.now() - AUTH_CONSTANTS.SESSION_INACTIVITY_TIMEOUT_MS - 1;

    const result = validateSession(session.sessionId);
    expect(result).toBeNull();
    expect(getSessionCount()).toBe(0);
  });

  it('should refresh last activity on successful validation', () => {
    const session = createSession('user-1', Role.STAFF);
    const beforeValidation = session.lastActivity;

    // Small delay to ensure timestamp difference
    const validated = validateSession(session.sessionId);
    expect(validated).not.toBeNull();
    expect(validated!.lastActivity).toBeGreaterThanOrEqual(beforeValidation);
  });

  it('should destroy a session', () => {
    const session = createSession('user-1', Role.ADMIN);
    expect(getSessionCount()).toBe(1);

    const destroyed = destroySession(session.sessionId);
    expect(destroyed).toBe(true);
    expect(getSessionCount()).toBe(0);
    expect(validateSession(session.sessionId)).toBeNull();
  });

  it('should destroy all sessions for a specific user', () => {
    createSession('user-1', Role.ADMIN);
    createSession('user-1', Role.ADMIN);
    createSession('user-2', Role.STAFF);
    expect(getSessionCount()).toBe(3);

    const count = destroyUserSessions('user-1');
    expect(count).toBe(2);
    expect(getSessionCount()).toBe(1);
  });

  it('should return false when destroying a non-existent session', () => {
    const result = destroySession('00000000-0000-4000-a000-000000000000');
    expect(result).toBe(false);
  });
});
