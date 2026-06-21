import type { Response } from 'express';

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: ApiError;
  timestamp: string;
  requestId: string;
}

const nowISO = () => new Date().toISOString();
const generateRequestId = () => `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export const successResponse = <T>(res: Response, data: T, statusCode = 200): Response => {
  const response: ApiResponse<T> = {
    success: true,
    data,
    timestamp: nowISO(),
    requestId: res.locals.requestId || generateRequestId(),
  };
  return res.status(statusCode).json(response);
};

export const errorResponse = (
  res: Response,
  code: string,
  message: string,
  statusCode = 400,
  details?: Record<string, unknown>
): Response => {
  const response: ApiResponse = {
    success: false,
    error: { code, message, details },
    timestamp: nowISO(),
    requestId: res.locals.requestId || generateRequestId(),
  };
  return res.status(statusCode).json(response);
};

export const notFoundResponse = (res: Response, message = 'Resource not found'): Response => {
  return errorResponse(res, 'NOT_FOUND', message, 404);
};

export const unauthorizedResponse = (res: Response, message = 'Authentication required', code = 'AUTH_REQUIRED'): Response => {
  return errorResponse(res, code, message, 401);
};

export const forbiddenResponse = (res: Response, message = 'Insufficient permission', code = 'INSUFFICIENT_PERMISSION'): Response => {
  return errorResponse(res, code, message, 403);
};

export const badRequestResponse = (res: Response, message: string, code = 'BAD_REQUEST', details?: Record<string, unknown>): Response => {
  return errorResponse(res, code, message, 400, details);
};

export const serverErrorResponse = (res: Response, message = 'Server internal error', details?: Record<string, unknown>): Response => {
  return errorResponse(res, 'INTERNAL_ERROR', message, 500, details);
};
