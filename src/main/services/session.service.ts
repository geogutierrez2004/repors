/**
 * In-memory session management service.
 *
 * Sessions are stored in a Map keyed by sessionId.
 * Enforces inactivity timeout and absolute expiration (spec §4.1).
 */
import { v4 as uuidv4 } from 'uuid';
import { AUTH_CONSTANTS, type Role } from '../../shared/constants';
import type { Session } from '../../shared/types';

const sessions = new Map<string, Session>();

/** Create a new session for the given user. Returns the session object. */
export function createSession(userId: string, role: Role): Session {
  const now = Date.now();
  const session: Session = {
    sessionId: uuidv4(),
    userId,
    role,
    createdAt: now,
    lastActivity: now,
  };
  sessions.set(session.sessionId, session);
  return session;
}

/**
 * Validate and refresh a session.
 * Returns the session if valid, or null if expired/invalid.
 */
export function validateSession(sessionId: string): Session | null {
  const session = sessions.get(sessionId);
  if (!session) return null;

  const now = Date.now();

  // Check absolute expiration
  if (now - session.createdAt > AUTH_CONSTANTS.SESSION_ABSOLUTE_EXPIRY_MS) {
    sessions.delete(sessionId);
    return null;
  }

  // Check inactivity timeout
  if (now - session.lastActivity > AUTH_CONSTANTS.SESSION_INACTIVITY_TIMEOUT_MS) {
    sessions.delete(sessionId);
    return null;
  }

  // Refresh last activity timestamp
  session.lastActivity = now;
  return session;
}

/** Destroy a session (logout). */
export function destroySession(sessionId: string): boolean {
  return sessions.delete(sessionId);
}

/** Destroy all sessions for a specific user. */
export function destroyUserSessions(userId: string): number {
  let count = 0;
  for (const [id, session] of sessions) {
    if (session.userId === userId) {
      sessions.delete(id);
      count++;
    }
  }
  return count;
}

/** List all currently active (non-expired) sessions with their user IDs. */
export function listSessions(): Session[] {
  const now = Date.now();
  const active: Session[] = [];
  for (const [, session] of sessions) {
    if (
      now - session.createdAt <= AUTH_CONSTANTS.SESSION_ABSOLUTE_EXPIRY_MS &&
      now - session.lastActivity <= AUTH_CONSTANTS.SESSION_INACTIVITY_TIMEOUT_MS
    ) {
      active.push({ ...session });
    }
  }
  return active;
}

/** Get session count (useful for testing). */
export function getSessionCount(): number {
  return sessions.size;
}

/** Clear all sessions (useful for testing). */
export function clearAllSessions(): void {
  sessions.clear();
}
