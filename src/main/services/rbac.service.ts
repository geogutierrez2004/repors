/**
 * Role-based access control service.
 *
 * Defines permissions per role and provides a gate check
 * applied on every privileged IPC operation (spec §4.1).
 */
import { Role } from '../../shared/constants';

/** All defined permissions in the system. */
export enum Permission {
  // Auth
  CHANGE_OWN_PASSWORD = 'change_own_password',

  // User management
  USER_CREATE = 'user_create',
  USER_LIST = 'user_list',
  USER_UPDATE = 'user_update',
  USER_DELETE = 'user_delete',
  USER_RESET_PASSWORD = 'user_reset_password',
  USER_UNLOCK = 'user_unlock',

  // File operations
  FILE_UPLOAD = 'file_upload',
  FILE_DOWNLOAD = 'file_download',
  FILE_DELETE = 'file_delete',

  // Shelf management
  SHELF_CREATE = 'shelf_create',
  SHELF_DELETE = 'shelf_delete',
  SHELF_LIST = 'shelf_list',

  // Storage management
  STORAGE_VIEW_QUOTA = 'storage_view_quota',
  STORAGE_BACKUP = 'storage_backup',
  STORAGE_RESTORE = 'storage_restore',
}

/** Permission matrix: role → set of allowed permissions. */
const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  [Role.ADMIN]: new Set(Object.values(Permission)),
  [Role.STAFF]: new Set([
    Permission.CHANGE_OWN_PASSWORD,
    Permission.FILE_UPLOAD,
    Permission.FILE_DOWNLOAD,
    Permission.SHELF_LIST,
    Permission.STORAGE_VIEW_QUOTA,
  ]),
};

/**
 * Check if a role has a specific permission.
 * This is the server-side gate applied on every operation (spec §4.1).
 */
export function hasPermission(role: Role, permission: Permission): boolean {
  const perms = ROLE_PERMISSIONS[role];
  return perms ? perms.has(permission) : false;
}

/**
 * Require a permission – throws if the role lacks it.
 * Use in IPC handlers before executing privileged operations.
 */
export function requirePermission(role: Role, permission: Permission): void {
  if (!hasPermission(role, permission)) {
    throw new RbacError(
      'FORBIDDEN',
      `Role '${role}' does not have permission '${permission}'`,
    );
  }
}

/** Custom error for RBAC failures. */
export class RbacError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RbacError';
  }
}
