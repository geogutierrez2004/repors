/**
 * IPC handler registry.
 *
 * Centralizes all handler registrations so the main process entry
 * point has a single call to set up all IPC communication.
 */
import type { AuthService } from '../services/auth.service';
import { registerAuthHandlers } from './auth.handler';

export function registerAllHandlers(services: { authService: AuthService }): void {
  registerAuthHandlers(services.authService);
}
