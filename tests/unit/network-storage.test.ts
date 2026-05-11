/**
 * Network Storage Tests
 *
 * Tests for network storage configuration, validation, and file movement operations.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { DashboardService } from '../main/services/dashboard.service';
import { AuthService } from '../main/services/auth.service';

describe('Network Storage', () => {
  let db: Database.Database;
  let dashboardService: DashboardService;
  let authService: AuthService;
  let testSessionId: string;

  beforeEach(() => {
    // Create in-memory database for testing
    db = new Database(':memory:');

    // Initialize schema
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'admin',
        is_active INTEGER DEFAULT 1,
        failed_attempts INTEGER DEFAULT 0,
        locked_until INTEGER,
        created_at TEXT DEFAULT datetime('now'),
        updated_at TEXT DEFAULT datetime('now')
      );

      CREATE TABLE IF NOT EXISTS shelves (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        is_system INTEGER DEFAULT 0,
        created_by TEXT REFERENCES users(id),
        created_at TEXT DEFAULT datetime('now', 'utc'),
        updated_at TEXT DEFAULT datetime('now', 'utc')
      );

      CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY,
        original_name TEXT NOT NULL,
        original_extension TEXT,
        stored_name TEXT NOT NULL,
        mime_type TEXT,
        size_bytes INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        shelf_id TEXT REFERENCES shelves(id),
        uploaded_by TEXT REFERENCES users(id),
        is_encrypted INTEGER DEFAULT 0,
        payload_id TEXT,
        storage_location TEXT DEFAULT 'local',
        synced_at TEXT,
        sync_error TEXT,
        created_at TEXT DEFAULT datetime('now', 'utc'),
        updated_at TEXT DEFAULT datetime('now', 'utc')
      );

      CREATE TABLE IF NOT EXISTS file_payloads (
        id TEXT PRIMARY KEY,
        stored_name TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        is_encrypted INTEGER DEFAULT 0,
        ref_count INTEGER DEFAULT 1,
        storage_location TEXT DEFAULT 'local',
        created_at TEXT DEFAULT datetime('now', 'utc'),
        updated_at TEXT DEFAULT datetime('now', 'utc')
      );

      CREATE TABLE IF NOT EXISTS network_settings (
        id TEXT PRIMARY KEY,
        network_path TEXT NOT NULL,
        enabled INTEGER DEFAULT 0,
        created_at TEXT DEFAULT datetime('now', 'utc'),
        updated_at TEXT DEFAULT datetime('now', 'utc')
      );

      CREATE TABLE IF NOT EXISTS activity_log (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        action TEXT,
        detail TEXT,
        created_at TEXT DEFAULT datetime('now', 'utc')
      );

      CREATE TABLE IF NOT EXISTS storage_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS app_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS encryption_keys (
        id TEXT PRIMARY KEY,
        file_id TEXT UNIQUE REFERENCES files(id),
        salt TEXT NOT NULL,
        iv TEXT NOT NULL,
        auth_tag TEXT NOT NULL,
        iterations INTEGER NOT NULL,
        created_at TEXT DEFAULT datetime('now', 'utc')
      );

      CREATE TABLE IF NOT EXISTS upload_history (
        id TEXT PRIMARY KEY,
        file_id TEXT REFERENCES files(id),
        user_id TEXT REFERENCES users(id),
        status TEXT DEFAULT 'pending',
        error TEXT,
        started_at TEXT DEFAULT datetime('now', 'utc'),
        completed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS downloads (
        id TEXT PRIMARY KEY,
        file_id TEXT REFERENCES files(id),
        user_id TEXT REFERENCES users(id),
        downloaded_at TEXT DEFAULT datetime('now', 'utc')
      );

      CREATE INDEX IF NOT EXISTS idx_files_storage_location ON files(storage_location);
      CREATE INDEX IF NOT EXISTS idx_file_payloads_storage_location ON file_payloads(storage_location);
    `);

    // Create test user and session
    authService = new AuthService(db);
    dashboardService = new DashboardService(db, authService);

    // Create initial shelf
    const shelfRes = db.prepare(`
      INSERT INTO shelves (id, name, is_system, created_by)
      VALUES (?, ?, 0, NULL)
    `).run('test-shelf', 'Test Shelf');

    // Create test user
    const testUser = db.prepare(`
      INSERT INTO users (id, username, password_hash, role, is_active)
      VALUES (?, ?, ?, ?, 1)
    `).run('test-user-123', 'testuser', 'hashed_password', 'admin');

    // Mock session (in real scenario, this would be validated via validateSession)
    testSessionId = 'test-session-123';
  });

  describe('Network Settings', () => {
    it('should return null when network settings not configured', () => {
      // Network settings should return disabled status
      const settings = db.prepare(`
        SELECT id, network_path, enabled FROM network_settings
        WHERE enabled = 1 ORDER BY created_at DESC LIMIT 1
      `).get();
      
      expect(settings).toBeUndefined();
    });

    it('should validate UNC path format', () => {
      // Valid UNC paths
      const validPaths = [
        '\\\\server\\share',
        '\\\\192.168.1.1\\storage',
        '\\\\my-server\\data\\files',
      ];

      for (const validPath of validPaths) {
        const isValid = /^\\\\[^\\]+\\[^\\]+/.test(validPath);
        expect(isValid).toBe(true);
      }

      // Invalid paths
      const invalidPaths = [
        'C:\\local\\path',
        '/unix/path',
        'server\share',
        'localhost/share',
      ];

      for (const invalidPath of invalidPaths) {
        const isValid = /^\\\\[^\\]+\\[^\\]+/.test(invalidPath);
        expect(isValid).toBe(false);
      }
    });
  });

  describe('File Storage Location', () => {
    it('should track file storage location', () => {
      const fileId = 'test-file-123';
      const payloadId = 'test-payload-123';

      // Insert file with local storage
      db.prepare(`
        INSERT INTO files (id, original_name, stored_name, shelf_id, uploaded_by, 
                          storage_location, sha256, size_bytes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(fileId, 'test.txt', 'test-uuid', 'test-shelf', 'test-user-123', 
             'local', 'abc123', 1024);

      // Verify storage location
      const file = db.prepare(`
        SELECT id, original_name, storage_location FROM files WHERE id = ?
      `).get(fileId) as any;

      expect(file.storage_location).toBe('local');
    });

    it('should update file storage location', () => {
      const fileId = 'test-file-456';

      // Insert file as local
      db.prepare(`
        INSERT INTO files (id, original_name, stored_name, shelf_id, uploaded_by, 
                          storage_location, sha256, size_bytes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(fileId, 'test.txt', 'test-uuid', 'test-shelf', 'test-user-123', 
             'local', 'abc123', 1024);

      // Update to network
      db.prepare(`
        UPDATE files SET storage_location = ?, synced_at = datetime('now', 'utc')
        WHERE id = ?
      `).run('network', fileId);

      // Verify update
      const file = db.prepare(`
        SELECT storage_location, synced_at FROM files WHERE id = ?
      `).get(fileId) as any;

      expect(file.storage_location).toBe('network');
      expect(file.synced_at).not.toBeNull();
    });
  });

  describe('Network File Sync', () => {
    it('should track sync status', () => {
      const fileId = 'test-file-sync-123';

      // Insert file with sync metadata
      db.prepare(`
        INSERT INTO files (id, original_name, stored_name, shelf_id, uploaded_by, 
                          storage_location, synced_at, sha256, size_bytes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(fileId, 'test.txt', 'test-uuid', 'test-shelf', 'test-user-123', 
             'network', datetime('now', 'utc'), 'abc123', 1024);

      const file = db.prepare(`
        SELECT synced_at FROM files WHERE id = ?
      `).get(fileId) as any;

      expect(file.synced_at).not.toBeNull();
    });

    it('should record sync errors', () => {
      const fileId = 'test-file-error-123';

      // Insert file with sync error
      db.prepare(`
        INSERT INTO files (id, original_name, stored_name, shelf_id, uploaded_by, 
                          storage_location, sync_error, sha256, size_bytes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(fileId, 'test.txt', 'test-uuid', 'test-shelf', 'test-user-123', 
             'network', 'Network path not accessible', 'abc123', 1024);

      const file = db.prepare(`
        SELECT sync_error FROM files WHERE id = ?
      `).get(fileId) as any;

      expect(file.sync_error).toBe('Network path not accessible');
    });
  });

  describe('Activity Logging', () => {
    it('should log network path configuration', () => {
      const userId = 'test-user-123';
      const action = 'NETWORK_PATH_SET';
      const detail = 'Network path set to \\\\server\\share';

      db.prepare(`
        INSERT INTO activity_log (id, user_id, action, detail)
        VALUES (?, ?, ?, ?)
      `).run('activity-123', userId, action, detail);

      const log = db.prepare(`
        SELECT action, detail FROM activity_log WHERE id = ?
      `).get('activity-123') as any;

      expect(log.action).toBe('NETWORK_PATH_SET');
      expect(log.detail).toBe(detail);
    });

    it('should log file movement operations', () => {
      const userId = 'test-user-123';
      const action = 'FILE_MOVED_TO_NETWORK';
      const detail = 'File document.pdf moved to network storage';

      db.prepare(`
        INSERT INTO activity_log (id, user_id, action, detail)
        VALUES (?, ?, ?, ?)
      `).run('activity-456', userId, action, detail);

      const log = db.prepare(`
        SELECT action FROM activity_log WHERE action = ?
      `).get(action) as any;

      expect(log.action).toBe(action);
    });
  });
});
