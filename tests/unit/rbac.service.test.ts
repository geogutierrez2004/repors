/**
 * Unit tests for RBAC service.
 */
import { describe, it, expect } from 'vitest';
import { hasPermission, requirePermission, Permission, RbacError } from '../../src/main/services/rbac.service';
import { Role } from '../../src/shared/constants';

describe('RBAC Service', () => {
  describe('admin role', () => {
    it('should have all permissions', () => {
      for (const perm of Object.values(Permission)) {
        expect(hasPermission(Role.ADMIN, perm)).toBe(true);
      }
    });
  });

  describe('staff role', () => {
    it('should have basic file permissions', () => {
      expect(hasPermission(Role.STAFF, Permission.FILE_UPLOAD)).toBe(true);
      expect(hasPermission(Role.STAFF, Permission.FILE_DOWNLOAD)).toBe(true);
      expect(hasPermission(Role.STAFF, Permission.SHELF_LIST)).toBe(true);
      expect(hasPermission(Role.STAFF, Permission.STORAGE_VIEW_QUOTA)).toBe(true);
      expect(hasPermission(Role.STAFF, Permission.CHANGE_OWN_PASSWORD)).toBe(true);
    });

    it('should NOT have admin permissions', () => {
      expect(hasPermission(Role.STAFF, Permission.USER_CREATE)).toBe(false);
      expect(hasPermission(Role.STAFF, Permission.USER_DELETE)).toBe(false);
      expect(hasPermission(Role.STAFF, Permission.USER_LIST)).toBe(false);
      expect(hasPermission(Role.STAFF, Permission.USER_UPDATE)).toBe(false);
      expect(hasPermission(Role.STAFF, Permission.STORAGE_BACKUP)).toBe(false);
      expect(hasPermission(Role.STAFF, Permission.STORAGE_RESTORE)).toBe(false);
      expect(hasPermission(Role.STAFF, Permission.FILE_DELETE)).toBe(false);
      expect(hasPermission(Role.STAFF, Permission.SHELF_CREATE)).toBe(false);
      expect(hasPermission(Role.STAFF, Permission.SHELF_DELETE)).toBe(false);
    });
  });

  describe('requirePermission', () => {
    it('should not throw for admin with any permission', () => {
      expect(() => requirePermission(Role.ADMIN, Permission.USER_CREATE)).not.toThrow();
    });

    it('should throw RbacError for staff with admin-only permission', () => {
      expect(() => requirePermission(Role.STAFF, Permission.USER_CREATE)).toThrow(RbacError);
    });

    it('should not throw for staff with allowed permission', () => {
      expect(() => requirePermission(Role.STAFF, Permission.FILE_UPLOAD)).not.toThrow();
    });

    it('should throw with correct code', () => {
      try {
        requirePermission(Role.STAFF, Permission.USER_DELETE);
        expect.fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(RbacError);
        expect((e as RbacError).code).toBe('FORBIDDEN');
      }
    });
  });

  describe('edge cases', () => {
    it('should return false for an unknown role', () => {
      expect(hasPermission('unknown' as Role, Permission.FILE_UPLOAD)).toBe(false);
    });
  });
});
