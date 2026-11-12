import { createHash, randomBytes } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import type { Pool } from './db.ts'
import { USER_COLUMNS, type User } from './users.ts'

export const SESSION_COOKIE = 'ia_session'
const SESSION_DAYS = 30

declare module 'express-serve-static-core' {
  interface Request {
    user?: User
  }
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

export async function createSession(pool: Pool, req: Request, res: Response, userId: number): Promise<void> {
  const token = randomBytes(32).toString('base64url')
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000)
  await pool.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [
    hashToken(token), userId, expires,
  ])
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    // req.secure honours X-Forwarded-Proto from Traefik (trust proxy is on).
    secure: req.secure,
    expires,
    path: '/',
  })
}

export async function destroySession(pool: Pool, req: Request, res: Response): Promise<void> {
  const token = req.cookies?.[SESSION_COOKIE]
  if (token) await pool.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)])
  res.clearCookie(SESSION_COOKIE, { path: '/' })
}

/** Populates req.user from the session cookie, if valid. Never rejects. */
export function loadUser(pool: Pool) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const token = req.cookies?.[SESSION_COOKIE]
    if (token) {
      const { rows } = await pool.query<User>(
        `SELECT ${USER_COLUMNS.split(', ').map((c) => `u.${c}`).join(', ')}
           FROM sessions s JOIN users u ON u.id = s.user_id
          WHERE s.token_hash = $1 AND s.expires_at > now()`,
        [hashToken(token)],
      )
      req.user = rows[0]
    }
    next()
  }
}

export function requireUser(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'Not signed in' })
  next()
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'Not signed in' })
  if (!req.user.isAdmin) return res.status(403).json({ error: 'Admins only' })
  next()
}

/**
 * Rejects state-changing requests whose Origin doesn't match the Host. SameSite=Lax
 * already blocks most CSRF; this covers older browsers and same-site subdomains.
 */
export function checkOrigin(req: Request, res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next()
  const origin = req.get('origin')
  if (origin && new URL(origin).host !== req.get('host')) {
    return res.status(403).json({ error: 'Cross-origin request rejected' })
  }
  next()
}

/** Simple in-memory limiter for login attempts, keyed by IP + username. */
export class LoginLimiter {
  private attempts = new Map<string, { count: number; resetAt: number }>()
  private max: number
  private windowMs: number

  constructor(max = 10, windowMs = 15 * 60_000) {
    this.max = max
    this.windowMs = windowMs
  }

  isBlocked(key: string): boolean {
    const entry = this.attempts.get(key)
    if (!entry || entry.resetAt < Date.now()) return false
    return entry.count >= this.max
  }

  fail(key: string): void {
    const now = Date.now()
    const entry = this.attempts.get(key)
    if (!entry || entry.resetAt < now) this.attempts.set(key, { count: 1, resetAt: now + this.windowMs })
    else entry.count++
  }

  reset(key: string): void {
    this.attempts.delete(key)
  }
}
