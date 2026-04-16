import type Database from 'better-sqlite3';
import { AuthService } from './auth.service';
import { DashboardService } from './dashboard.service';

export interface MainServices {
  authService: AuthService;
  dashboardService: DashboardService;
}

export function createServices(
  db: Database.Database,
  options?: {
    restoreExecutor?: (request: {
      backupDir: string;
      backupDbPath: string;
      backupFilesDir: string;
      actorUserId: string;
    }) => Promise<void>;
  },
): MainServices {
  return {
    authService: new AuthService(db),
    dashboardService: new DashboardService(db, options?.restoreExecutor),
  };
}
