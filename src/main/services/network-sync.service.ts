/**
 * Network Storage Sync Service.
 *
 * Provides periodic scanning of network storage locations to detect new files,
 * validate integrity, and sync metadata with the local database.
 */
import type Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';

export class NetworkSyncService {
  private syncInterval: NodeJS.Timeout | null = null;
  private isSyncing = false;

  constructor(private db: Database.Database) {}

  /**
   * Start periodic network storage synchronization.
   * @param intervalMs Sync interval in milliseconds (default: 30000 = 30 seconds)
   */
  startSync(intervalMs: number = 30_000): void {
    if (this.syncInterval) return; // Already running

    this.syncInterval = setInterval(async () => {
      if (this.isSyncing) return; // Skip if already syncing
      this.isSyncing = true;
      try {
        await this.performSync();
      } catch (e) {
        console.error('[NetworkSync] Error during sync:', e);
      } finally {
        this.isSyncing = false;
      }
    }, intervalMs);

    // Don't block the event loop
    this.syncInterval.unref();
  }

  /**
   * Stop periodic network storage synchronization.
   */
  stopSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  /**
   * Perform a manual sync operation.
   */
  async performSync(): Promise<void> {
    try {
      const settings = this.db
        .prepare('SELECT id, network_path, enabled FROM network_settings WHERE enabled = 1 ORDER BY created_at DESC LIMIT 1')
        .get() as { id: string; network_path: string; enabled: number } | undefined;

      if (!settings) return; // Network storage not configured

      const networkFilesDir = path.join(settings.network_path, 'network', 'sccfs', 'files');
      
      // Check if network path is accessible
      if (!fs.existsSync(networkFilesDir)) {
        return; // Network not available, skip sync
      }

      // Scan for new files on network
      const networkFiles = fs.readdirSync(networkFilesDir, { withFileTypes: true })
        .filter(entry => entry.isFile())
        .map(entry => entry.name);

      // Find files in network storage that are not yet synced to local DB
      const existingPayloads = this.db
        .prepare('SELECT stored_name FROM file_payloads WHERE storage_location = "network"')
        .all() as Array<{ stored_name: string }>;

      const existingNames = new Set(existingPayloads.map(p => p.stored_name));

      for (const fileName of networkFiles) {
        if (existingNames.has(fileName)) {
          continue; // Already in database
        }

        // This is a new file on the network share
        // For now, we just log it. In a more complete implementation,
        // you might want to create a "pending" file record that the user
        // can confirm to add to their library.
        console.log(`[NetworkSync] Detected new network file: ${fileName}`);
      }
    } catch (e) {
      console.error('[NetworkSync] Sync error:', e);
    }
  }

  /**
   * Validate file integrity on the network storage.
   * @param filePath Path to the file on network storage
   * @param expectedSha256 Expected SHA256 hash
   * @returns true if integrity check passes
   */
  async validateNetworkFileIntegrity(filePath: string, expectedSha256: string): Promise<boolean> {
    try {
      if (!fs.existsSync(filePath)) {
        return false;
      }

      const hash = crypto.createHash('sha256');
      const data = fs.readFileSync(filePath);
      hash.update(data);
      const actualSha256 = hash.digest('hex');

      return actualSha256 === expectedSha256;
    } catch {
      return false;
    }
  }

  /**
   * Check if network storage is currently accessible.
   * @param networkPath Path to the network storage
   * @returns true if accessible
   */
  isNetworkAccessible(networkPath: string): boolean {
    try {
      fs.accessSync(networkPath);
      return true;
    } catch {
      return false;
    }
  }
}
