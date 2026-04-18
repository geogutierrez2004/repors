/**
 * Zod-based IPC payload validation schemas.
 *
 * Every IPC handler validates its payload before processing (spec §2.1).
 */
import { z } from 'zod';
import { Role } from '../../shared/constants';

export const LoginSchema = z.object({
  username: z.string().min(1, 'Username is required').max(255),
  password: z.string().min(1, 'Password is required').max(255),
});

export const LogoutSchema = z.object({
  sessionId: z.string().uuid('Invalid session ID'),
});

export const ValidateSessionSchema = z.object({
  sessionId: z.string().uuid('Invalid session ID'),
});

export const ChangePasswordSchema = z.object({
  sessionId: z.string().uuid('Invalid session ID'),
  currentPassword: z.string().min(1),
  newPassword: z.string().min(1),
});

export const GetCurrentUserSchema = z.object({
  sessionId: z.string().uuid('Invalid session ID'),
});

export const CreateUserSchema = z.object({
  sessionId: z.string().uuid('Invalid session ID'),
  username: z.string().min(1).max(255),
  password: z.string().min(1).max(255),
  role: z.nativeEnum(Role),
});

export const UpdateUserSchema = z.object({
  sessionId: z.string().uuid('Invalid session ID'),
  userId: z.string().uuid('Invalid user ID'),
  role: z.nativeEnum(Role).optional(),
  is_active: z.boolean().optional(),
});

export const DeleteUserSchema = z.object({
  sessionId: z.string().uuid('Invalid session ID'),
  userId: z.string().uuid('Invalid user ID'),
});

export const ResetPasswordSchema = z.object({
  sessionId: z.string().uuid('Invalid session ID'),
  userId: z.string().uuid('Invalid user ID'),
  newPassword: z.string().min(1).max(255),
});

export const UnlockUserSchema = z.object({
  sessionId: z.string().uuid('Invalid session ID'),
  userId: z.string().uuid('Invalid user ID'),
});

export const ListUsersSchema = z.object({
  sessionId: z.string().uuid('Invalid session ID'),
});

// ────────────────────────────────────────
// Dashboard / file / shelf / storage validators
// ────────────────────────────────────────

export const SessionIdOnlySchema = z.object({
  sessionId: z.string().uuid('Invalid session ID'),
});

export const SecurityIntegrityStatsSchema = z.object({
  sessionId: z.string().uuid('Invalid session ID'),
});

export const SecurityThresholdGetSchema = z.object({
  sessionId: z.string().uuid('Invalid session ID'),
});

export const SecurityThresholdSetSchema = z.object({
  sessionId: z.string().uuid('Invalid session ID'),
  settings: z.object({
    storage_warn_percent: z.number().min(1).max(99),
    storage_danger_percent: z.number().min(1).max(100),
    upload_fail_warn_24h: z.number().int().min(0).max(1000),
    upload_fail_danger_24h: z.number().int().min(0).max(1000),
  }).superRefine((value, ctx) => {
    if (value.storage_warn_percent >= value.storage_danger_percent) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['storage_warn_percent'],
        message: 'Storage warning threshold must be lower than danger threshold',
      });
    }
    if (value.upload_fail_warn_24h > value.upload_fail_danger_24h) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['upload_fail_warn_24h'],
        message: 'Upload warning threshold must be less than or equal to danger threshold',
      });
    }
  }),
});

export const FileListSchema = z.object({
  sessionId: z.string().uuid(),
  shelfId: z.string().uuid().optional(),
  search: z.string().max(255).optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
});

export const FileUploadSchema = z.object({
  sessionId: z.string().uuid(),
  shelfId: z.string().uuid(),
  encrypt: z.boolean().default(false),
  encryptionPassword: z.string().min(1).max(1024).optional(),
  sourceHandlingMode: z.enum(['keep_original', 'move_to_system', 'ask_each_time']).default('keep_original'),
  confirmPermanentDelete: z.boolean().default(false),
}).superRefine((value, ctx) => {
  if (value.encrypt && !value.encryptionPassword?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['encryptionPassword'],
      message: 'Encryption password is required when encrypting upload',
    });
  }
});

export const FileDownloadSchema = z.object({
  sessionId: z.string().uuid(),
  fileId: z.string().uuid(),
  decryptionPassword: z.string().min(1).max(1024).optional(),
});

export const FileViewEncryptedSchema = z.object({
  sessionId: z.string().uuid(),
  fileId: z.string().uuid(),
  decryptionPassword: z.string().min(1).max(1024),
});

export const FileViewEncryptedCleanupSchema = z.object({
  sessionId: z.string().uuid(),
  viewId: z.string().uuid(),
});

export const FileDeleteSchema = z.object({
  sessionId: z.string().uuid(),
  fileId: z.string().uuid(),
});

export const FileMoveSchema = z.object({
  sessionId: z.string().uuid(),
  fileId: z.string().uuid(),
  shelfId: z.string().uuid(),
});

export const ShelfCreateSchema = z.object({
  sessionId: z.string().uuid(),
  name: z.string().min(1).max(100),
});

export const ShelfDeleteSchema = z.object({
  sessionId: z.string().uuid(),
  shelfId: z.string().uuid(),
});

export const ShelfRenameSchema = z.object({
  sessionId: z.string().uuid(),
  shelfId: z.string().uuid(),
  name: z.string().min(1).max(100),
});

export const ActivityListSchema = z.object({
  sessionId: z.string().uuid(),
  userId: z.string().uuid().optional(),
  action: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(50),
});

export const StorageSetQuotaSchema = z.object({
  sessionId: z.string().uuid(),
  quotaBytes: z.number().int().positive(),
});

export const SessionTerminateSchema = z.object({
  sessionId: z.string().uuid(),
  targetSessionId: z.string().uuid(),
});
