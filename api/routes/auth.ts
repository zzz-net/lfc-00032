import { Router, type Request, type Response } from 'express';
import { authenticateUser, logoutSession, requireAuth } from '../middleware/auth.js';
import { successResponse, badRequestResponse, unauthorizedResponse } from '../lib/response.js';
import { generateId, nowISO, getDB } from '../lib/db.js';
import {
  getPermissionSnapshot,
  getServiceStatus,
  flushOperationLogs,
  createOperationLog,
} from '../services/flowTracePermissionService.js';
import { ROLE_LABELS } from '../../shared/constants.js';
import type { User } from '../../shared/types.js';

const router = Router();

router.post('/login', async (req: Request, res: Response): Promise<void> => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    badRequestResponse(res, '用户名和密码不能为空', 'MISSING_CREDENTIALS');
    return;
  }

  const result = authenticateUser(username, password);

  if (!result.success || !result.user || !result.sessionId) {
    unauthorizedResponse(res, result.errorMessage || '登录失败', result.errorCode);
    return;
  }

  const permissionSnapshot = getPermissionSnapshot({ ...result.user, passwordHash: '' } as User);

  const debugInfo = {
    loginAt: nowISO(),
    serverInstanceId: getServiceStatus().instanceId,
    serverStartedAt: getServiceStatus().startedAt,
    roleLabel: ROLE_LABELS[result.user.role],
    hasFlowTraceAccess: permissionSnapshot?.currentDecision !== 'deny',
    permissionDecision: permissionSnapshot?.currentDecision,
    visibleFieldsCount: permissionSnapshot?.visibleFields.length || 0,
  };

  res.cookie('sessionId', result.sessionId, {
    httpOnly: false,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000,
  });

  try {
    createOperationLog({
      user: result.user,
      action: 'login',
      status: 'success',
      permissionDecision: permissionSnapshot?.currentDecision,
    });
  } catch {}

  successResponse(res, {
    user: result.user,
    sessionId: result.sessionId,
    permissionSnapshot,
    debug: debugInfo,
  }, 200);
});

router.post('/logout', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const sessionId = req.sessionId || req.headers.authorization?.replace('Bearer ', '');
  logoutSession(sessionId || '', req.currentUser || null);
  res.clearCookie('sessionId');
  successResponse(res, { message: '登出成功' });
});

router.get('/me', requireAuth, async (req: Request, res: Response): Promise<void> => {
  if (!req.currentUser) {
    unauthorizedResponse(res, '未登录');
    return;
  }
  const { passwordHash: _pw, ...publicUser } = req.currentUser;
  const permissionSnapshot = getPermissionSnapshot(req.currentUser);
  successResponse(res, {
    user: publicUser,
    permissionSnapshot,
    serviceStatus: getServiceStatus(),
  });
});

router.get('/permission-snapshot', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const snapshot = getPermissionSnapshot(req.currentUser || null);
  successResponse(res, { snapshot });
});

router.get('/service-status', async (req: Request, res: Response): Promise<void> => {
  try { flushOperationLogs() } catch {}
  successResponse(res, getServiceStatus());
});

router.get('/debug/users', async (req: Request, res: Response): Promise<void> => {
  const users = getDB().users.map(({ passwordHash: _pw, ...u }) => u);
  successResponse(res, { users, count: users.length });
});

router.post('/debug/flush-logs', async (req: Request, res: Response): Promise<void> => {
  const flushed = flushOperationLogs();
  successResponse(res, { flushedCount: flushed.length });
});

export default router;
