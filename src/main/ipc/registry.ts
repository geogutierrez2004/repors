/**
 * IPC handler registry.
 *
 * Centralizes all handler registrations so the main process entry
 * point has a single call to set up all IPC communication.
 */
import type { AuthService } from '../services/auth.service';
import type { DashboardService } from '../services/dashboard.service';
import { registerAuthHandlers } from './auth.handler';
import { registerDashboardHandlers } from './dashboard.handler';

export function registerAllHandlers(services: {
  authService: AuthService;
  dashboardService: DashboardService;
}): void {
  registerAuthHandlers(services.authService);
  registerDashboardHandlers(services.dashboardService);
}
