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
