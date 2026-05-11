/**
 * Network Storage IPC handlers.
 *
 * Registers ipcMain.handle() for all sccfs:network:* channels.
 * Handles network storage configuration, testing, and file movement operations.
 */
import { ipcMain } from 'electron';
import os from 'os';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import type { IpcResponse } from '../../shared/types';
import { DashboardService } from '../services/dashboard.service';
import { AuthError } from '../services/auth.service';
import {
  GetNetworkSettingsSchema,
  SetNetworkPathSchema,
  TestNetworkConnectionSchema,
  MoveFileToNetworkSchema,
  MoveFileToLocalSchema,
} from './validators';
import { ZodError } from 'zod';

function ok<T>(data: T): IpcResponse<T> {
  return { ok: true, data };
}

function err(code: string, message: string, details?: unknown): IpcResponse {
  return { ok: false, error: { code, message, details } };
}

function handleError(e: unknown): IpcResponse {
  if (e instanceof ZodError) {
    return err('VALIDATION_ERROR', 'Invalid request payload', e.errors);
  }
  if (e instanceof AuthError) {
    return err(e.code, e.message);
  }
  const message = e instanceof Error ? e.message : 'Unknown error';
  return err('INTERNAL_ERROR', message);
}

type InvokeGuard = <T>(invoke: () => Promise<IpcResponse<T>>) => Promise<IpcResponse<T>>;

const passthroughGuard: InvokeGuard = async <T>(invoke: () => Promise<IpcResponse<T>>) => invoke();

const NETWORK_CHANNELS = [
  IPC_CHANNELS.NETWORK_GET_SETTINGS,
  IPC_CHANNELS.NETWORK_SET_PATH,
  IPC_CHANNELS.NETWORK_TEST_CONNECTION,
  IPC_CHANNELS.NETWORK_GET_HOST_IP,
  IPC_CHANNELS.NETWORK_MOVE_FILE_TO_NETWORK,
  IPC_CHANNELS.NETWORK_MOVE_FILE_TO_LOCAL,
] as const;

export function registerNetworkStorageHandlers(
  dashboardService: DashboardService,
  guard: InvokeGuard = passthroughGuard,
): () => void {
  // ── Get network settings ────────────────
  ipcMain.handle(IPC_CHANNELS.NETWORK_GET_SETTINGS, (_event, payload: unknown) =>
    guard(async () => {
      try {
        const { sessionId } = GetNetworkSettingsSchema.parse(payload);
        const settings = await dashboardService.getNetworkSettings(sessionId);
        return ok(settings);
      } catch (e) {
        return handleError(e);
      }
    }));

  // ── Set network path ────────────────
  ipcMain.handle(IPC_CHANNELS.NETWORK_SET_PATH, (_event, payload: unknown) =>
    guard(async () => {
      try {
        const { sessionId, networkPath } = SetNetworkPathSchema.parse(payload);
        const settings = await dashboardService.setNetworkPath(sessionId, networkPath);
        return ok(settings);
      } catch (e) {
        return handleError(e);
      }
    }));

  // ── Test network connection ────────────────
  ipcMain.handle(IPC_CHANNELS.NETWORK_TEST_CONNECTION, (_event, payload: unknown) =>
    guard(async () => {
      try {
        const { sessionId, networkPath } = TestNetworkConnectionSchema.parse(payload);
        const result = await dashboardService.testNetworkConnection(sessionId, networkPath);
        return ok(result);
      } catch (e) {
        return handleError(e);
      }
    }));

  // ── Get host IP address ────────────────
  ipcMain.handle(IPC_CHANNELS.NETWORK_GET_HOST_IP, () => {
    try {
      const interfaces = os.networkInterfaces();
      let hostIp = '192.168.1.100'; // Fallback default
      
      // Try to find the first non-loopback IPv4 address
      for (const name of Object.keys(interfaces)) {
        const ifaces = interfaces[name];
        if (!ifaces) continue;
        for (const iface of ifaces) {
          if (iface.family === 'IPv4' && !iface.internal) {
            hostIp = iface.address;
            break;
          }
        }
        if (hostIp !== '192.168.1.100') break;
      }
      
      return ok({ hostIp, hostname: os.hostname() });
    } catch (e) {
      return handleError(e);
    }
  });

  // ── Move file to network ────────────────
  ipcMain.handle(IPC_CHANNELS.NETWORK_MOVE_FILE_TO_NETWORK, (_event, payload: unknown) =>
    guard(async () => {
      try {
        const { sessionId, fileId } = MoveFileToNetworkSchema.parse(payload);
        const file = await dashboardService.moveFileToNetwork(sessionId, fileId);
        return ok(file);
      } catch (e) {
        return handleError(e);
      }
    }));

  // ── Move file to local ────────────────
  ipcMain.handle(IPC_CHANNELS.NETWORK_MOVE_FILE_TO_LOCAL, (_event, payload: unknown) =>
    guard(async () => {
      try {
        const { sessionId, fileId } = MoveFileToLocalSchema.parse(payload);
        const file = await dashboardService.moveFileToLocal(sessionId, fileId);
        return ok(file);
      } catch (e) {
        return handleError(e);
      }
    }));

  return () => {
    // Cleanup: no persistent resources to clean up
  };
}

export const allNetworkChannels = [...NETWORK_CHANNELS];
