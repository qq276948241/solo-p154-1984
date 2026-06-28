import { Request, Response, NextFunction } from 'express';
import jwt = require('jsonwebtoken');
import { ErrorCode } from '../constants/error-code';
import { throwError } from '../utils/app-error';

export interface JwtPayload {
  id: number;
  role: 'member' | 'coach';
  phone: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
    interface Response {
      jsonSuccess: <T>(data: T, message?: string) => Response;
      jsonFail: (code: ErrorCode, message?: string, data?: any) => Response;
    }
  }
}

export function generateToken(payload: JwtPayload): string {
  const secret = process.env.JWT_SECRET || 'gym_secret';
  const expiresIn = process.env.JWT_EXPIRES_IN || '7d';
  return jwt.sign(payload as any, secret as jwt.Secret, {
    expiresIn: expiresIn as any,
  });
}

export function verifyToken(token: string): JwtPayload {
  try {
    return jwt.verify(token, process.env.JWT_SECRET as string) as JwtPayload;
  } catch (e: any) {
    if (e.name === 'TokenExpiredError') {
      throwError(ErrorCode.TOKEN_EXPIRED);
    }
    throwError(ErrorCode.TOKEN_INVALID);
  }
}

export function authMiddleware(roles?: Array<'member' | 'coach'>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.jsonFail(ErrorCode.UNAUTHORIZED);
    }

    const token = authHeader.slice(7);
    try {
      const payload = verifyToken(token);
      if (roles && !roles.includes(payload.role)) {
        return res.jsonFail(ErrorCode.FORBIDDEN);
      }
      req.user = payload;
      next();
    } catch (e: any) {
      return res.jsonFail(e.code || ErrorCode.UNAUTHORIZED, e.message);
    }
  };
}
