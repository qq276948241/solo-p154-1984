import { Request, Response, NextFunction } from 'express';
import { ErrorCode, ErrorMessage } from '../constants/error-code';
import { AppError } from '../utils/app-error';

export interface ApiResponse<T = any> {
  code: number;
  message: string;
  data: T | null;
  timestamp: number;
}

export function success<T>(data: T, message = ErrorMessage[ErrorCode.SUCCESS]): ApiResponse<T> {
  return {
    code: ErrorCode.SUCCESS,
    message,
    data,
    timestamp: Date.now(),
  };
}

export function fail(
  code: ErrorCode,
  message?: string,
  data: any = null
): ApiResponse {
  return {
    code,
    message: message || ErrorMessage[code] || ErrorMessage[ErrorCode.INTERNAL_ERROR],
    data,
    timestamp: Date.now(),
  };
}

export function responseMiddleware(req: Request, res: Response, next: NextFunction) {
  res.jsonSuccess = function <T>(data: T, message?: string) {
    return this.json(success(data, message));
  };

  res.jsonFail = function (code: ErrorCode, message?: string, data?: any) {
    return this.status(200).json(fail(code, message, data));
  };

  next();
}

export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (err instanceof AppError) {
    return res.jsonFail(err.code, err.message, err.data);
  }

  console.error('[Unhandled Error]', err);
  return res.jsonFail(ErrorCode.INTERNAL_ERROR, undefined, {
    error: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
}
