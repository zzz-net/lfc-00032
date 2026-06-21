import type { User, UserRole } from '@shared/types';
import { ERROR_CODES } from '@shared/constants';

export interface PermissionCheckResult {
  allowed: boolean;
  errorCode?: string;
  errorMessage?: string;
}

const ROLE_PERMISSIONS: Record<UserRole, string[]> = {
  collector: [
    'batch:import',
    'sample:view',
    'sample:viewDetail',
    'transfer:view',
  ],
  warehouse: [
    'sample:view',
    'sample:viewDetail',
    'location:view',
    'location:manage',
    'transfer:inbound',
    'transfer:outbound',
    'transfer:view',
  ],
  tester: [
    'sample:view',
    'sample:viewDetail',
    'transfer:outbound',
    'transfer:testReceive',
    'transfer:testComplete',
    'transfer:view',
    'location:view',
  ],
  auditor: [
    'sample:view',
    'sample:viewDetail',
    'transfer:view',
    'transfer:archive',
    'transfer:rollback',
    'failed:view',
    'audit:view',
    'audit:export',
    'archive:review',
    'archive:reviewExport',
    'flowTrace:view',
    'flowTrace:viewDetail',
    'flowTrace:export',
    'location:view',
  ],
  admin: ['*'],
};

export const hasPermission = (user: User | null, permission: string): PermissionCheckResult => {
  if (!user) {
    return {
      allowed: false,
      errorCode: ERROR_CODES.AUTH_REQUIRED,
      errorMessage: '请先登录系统',
    };
  }

  const userPermissions = ROLE_PERMISSIONS[user.role];
  if (userPermissions.includes('*') || userPermissions.includes(permission)) {
    return { allowed: true };
  }

  return {
    allowed: false,
    errorCode: ERROR_CODES.INSUFFICIENT_PERMISSION,
    errorMessage: `当前角色无权执行此操作`,
  };
};

export const requireRole = (user: User | null, roles: UserRole[]): PermissionCheckResult => {
  if (!user) {
    return {
      allowed: false,
      errorCode: ERROR_CODES.AUTH_REQUIRED,
      errorMessage: '请先登录系统',
    };
  }

  if (roles.includes(user.role) || user.role === 'admin') {
    return { allowed: true };
  }

  return {
    allowed: false,
    errorCode: ERROR_CODES.INSUFFICIENT_PERMISSION,
    errorMessage: `需要以下角色之一: ${roles.join(', ')}`,
  };
};
