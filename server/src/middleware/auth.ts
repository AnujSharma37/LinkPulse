import type { NextFunction, Request, Response } from 'express';
import { SESSION_COOKIE, userFromToken } from '../lib/auth.js';
import { unauthorized } from '../lib/errors.js';

export interface AuthUser { id: string; email: string; display_name: string | null; created_at: Date; email_verified_at: Date | null }
declare global {
  namespace Express { interface Request { user?: AuthUser } }
}

export async function loadUser(req: Request, _res: Response, next: NextFunction) {
  const user = await userFromToken(req.cookies?.[SESSION_COOKIE]);
  if (user) req.user = user;
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) throw unauthorized();
  next();
}

/** The authenticated user's id. Only call after requireAuth. */
export const uid = (req: Request) => req.user!.id;
