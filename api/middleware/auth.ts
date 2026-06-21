import type { Request, Response, NextFunction } from 'express';
import type { User } from '../../shared/types.js';
import {
  findSessionById,
  findUserById,
  upsertSession,
  removeSession,
  nowISO,
  generateId,
  getDB,
  upsertAuditLog,
  getFlowTracePermissionStates,
} from '../lib/db.js';
import { hashPassword, ERROR_CODES } from '../../shared/constants.js';
import { unauthorizedResponse } from '../lib/response.js';
import { initPermissionStateFromDB } from '../services/flowTracePermissionService.js';

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

declare global {
  namespace Express {
    interface Request {
      currentUser?: User | null;
      sessionId?: string;
    }
  }
}

export interface LoginResult {
  success: boolean;
  user?: Omit<User, 'passwordHash'>;
  sessionId?: string;
  errorCode?: string;
  errorMessage?: string;
}

export const authenticateUser = (username: string, password: string): LoginResult => {
  const users = getDB().users;
  const user = users.find(u => u.username === username);

  if (!user || user.passwordHash !== hashPassword(password)) {
    return {
      success: false,
      errorCode: ERROR_CODES.INVALID_CREDENTIALS,
      errorMessage: '用户名或密码错误',
    };
  }

  const sessionId = generateId();
  const now = nowISO();

  upsertSession({
    id: sessionId,
    userId: user.id,
    createdAt: now,
    lastAccessAt: now,
  });

  const { passwordHash: _pw, ...publicUser } = user;

  upsertAuditLog({
    id: generateId(),
    timestamp: now,
    userId: user.id,
    action: 'login',
    targetType: 'user',
    details: { username: user.username },
  });

  return {
    success: true,
    user: publicUser,
    sessionId,
  };
};

export const logoutSession = (sessionId: string, user?: User | null): boolean => {
  if (sessionId) {
    removeSession(sessionId);
  }
  if (user) {
    upsertAuditLog({
      id: generateId(),
      timestamp: nowISO(),
      userId: user.id,
      action: 'logout',
      targetType: 'user',
      details: { username: user.username },
    });
  }
  return true;
};

export const validateSession = (sessionId: string): { user: User | null; valid: boolean; reason?: string } => {
  const session = findSessionById(sessionId);

  if (!session) {
    return { user: null, valid: false, reason: 'Session not found' };
  }

  const lastAccess = new Date(session.lastAccessAt).getTime();
  const now = Date.now();

  if (now - lastAccess > SESSION_TTL_MS) {
    removeSession(sessionId);
    return { user: null, valid: false, reason: 'Session expired' };
  }

  const user = findUserById(session.userId);
  if (!user) {
    removeSession(sessionId);
    return { user: null, valid: false, reason: 'User not found' };
  }

  upsertSession({
    ...session,
    lastAccessAt: nowISO(),
  });

  return { user, valid: true };
};

export const authMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers.authorization;
  const sessionIdFromHeader = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : undefined;

  let cookieSessionId: string | undefined;
  try {
    const cookieHeader = req.headers.cookie;
    if (cookieHeader) {
      const match = cookieHeader.match(/(?:^|;\s*)sessionId=([^;]+)/);
      if (match) cookieSessionId = match[1];
    }
  } catch {
    // ignore
  }

  const sessionId = sessionIdFromHeader || cookieSessionId || (req.query.sessionId as string);

  if (!sessionId) {
    req.currentUser = null;
    req.sessionId = undefined;
    return next();
  }

  const result = validateSession(sessionId);
  req.sessionId = sessionId;

  if (!result.valid || !result.user) {
    req.currentUser = null;
    return next();
  }

  req.currentUser = result.user;

  try {
    const states = getFlowTracePermissionStates();
    initPermissionStateFromDB(states);
  } catch {
    // ignore permission state init errors
  }

  next();
};

export const requireAuth = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.currentUser) {
    unauthorizedResponse(res, '请先登录系统', ERROR_CODES.AUTH_REQUIRED);
    return;
  }
  next();
};

export { SESSION_TTL_MS };
