import type { Request, Response, NextFunction } from 'express';
import type { FlowTracePermissionAction, User } from '../../shared/types.js';
import {
  checkFlowTracePermission,
  isAuditorRole,
  createOperationLog,
  wrapWithPermissionEnvelope,
  checkServiceRestartReauth,
  checkPermissionMidOperation,
  getPermissionSnapshot,
} from '../services/flowTracePermissionService.js';
import { forbiddenResponse, errorResponse } from '../lib/response.js';
import { ERROR_CODES } from '../../shared/constants.js';

export interface FlowTraceSecureRequest extends Request {
  flowTrace?: {
    action: FlowTracePermissionAction;
    permCheck: ReturnType<typeof checkFlowTracePermission>;
    isAuditor: boolean;
    operationStartAt: string;
    sampleId?: string;
  };
}

export const flowTracePermissionMiddleware = (action: FlowTracePermissionAction) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const secureReq = req as FlowTraceSecureRequest;
    const user = (req.currentUser || null) as User | null;
    const operationStartAt = new Date().toISOString();
    const sampleId = (req.params.sampleId || req.body?.sampleId || req.query.sampleId) as string | undefined;

    const restartCheck = checkServiceRestartReauth(user);
    if (restartCheck) {
      createOperationLog({
        user,
        action,
        status: 'denied',
        permissionDecision: 'deny',
        sampleId,
        denyReason: restartCheck.reason,
        errorCode: restartCheck.errorCode,
      });
      forbiddenResponse(res, restartCheck.reason, restartCheck.errorCode || ERROR_CODES.AUTH_REQUIRED);
      return;
    }

    const permCheck = checkFlowTracePermission(user, action, sampleId);

    if (permCheck.decision === 'deny') {
      createOperationLog({
        user,
        action,
        status: 'denied',
        permissionDecision: 'deny',
        sampleId,
        denyReason: permCheck.reason,
        errorCode: permCheck.errorCode,
      });
      forbiddenResponse(res, permCheck.reason, permCheck.errorCode || ERROR_CODES.INSUFFICIENT_PERMISSION);
      return;
    }

    const midCheck = checkPermissionMidOperation(user, action, operationStartAt);
    if (midCheck) {
      createOperationLog({
        user,
        action,
        status: 'denied',
        permissionDecision: 'deny',
        sampleId,
        denyReason: midCheck.reason,
        errorCode: midCheck.errorCode,
      });
      forbiddenResponse(res, midCheck.reason, midCheck.errorCode || ERROR_CODES.INSUFFICIENT_PERMISSION);
      return;
    }

    secureReq.flowTrace = {
      action,
      permCheck,
      isAuditor: user ? isAuditorRole(user.role) : false,
      operationStartAt,
      sampleId,
    };

    next();
  };
};

export const getCurrentPermissionSnapshot = (req: Request) => {
  const user = (req.currentUser || null) as User | null;
  return getPermissionSnapshot(user);
};

export { wrapWithPermissionEnvelope, createOperationLog, isAuditorRole };
