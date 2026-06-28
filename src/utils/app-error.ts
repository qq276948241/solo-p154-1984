import { ErrorCode } from '../constants/error-code';

export class AppError extends Error {
  public code: ErrorCode;
  public data: any;

  constructor(code: ErrorCode, message?: string, data: any = null) {
    super(message);
    this.code = code;
    this.data = data;
    this.name = 'AppError';
  }
}

export function throwError(code: ErrorCode, message?: string, data?: any): never {
  throw new AppError(code, message, data);
}
