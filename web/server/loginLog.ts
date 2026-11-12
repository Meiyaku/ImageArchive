import type { Request } from 'express'
import type { Pool } from './db.ts'

export type LoginResult = 'success' | 'failed' | 'throttled'

export interface LoginAttempt {
  id: number
  username: string
  userId: number | null
  result: LoginResult
  ip: string | null
  userAgent: string | null
  createdAt: string
}

export const LOGIN_LOG_DAYS = 90

/**
 * Records a sign-in attempt in the database and the server log. req.ip is the client
 * address as Traefik reports it (trust proxy is on). A logging failure never blocks
 * the sign-in itself.
 */
export async function recordLogin(
  pool: Pool, req: Request, username: string, result: LoginResult, userId: number | null,
): Promise<void> {
  const ip = req.ip ?? null
  const userAgent = req.get('user-agent')?.slice(0, 400) ?? null
  console.log(`login ${result} user=${JSON.stringify(username)} ip=${ip ?? '-'}`)
  try {
    await pool.query(
      'INSERT INTO login_attempts (username, user_id, result, ip, user_agent) VALUES ($1, $2, $3, $4, $5)',
      [username, userId, result, ip, userAgent],
    )
  } catch (err) {
    console.error('Could not record sign-in attempt:', err)
  }
}

export async function pruneLoginLog(pool: Pool): Promise<void> {
  await pool.query(`DELETE FROM login_attempts WHERE created_at < now() - make_interval(days => $1)`, [LOGIN_LOG_DAYS])
}

export async function recentLogins(pool: Pool, limit = 500): Promise<LoginAttempt[]> {
  const { rows } = await pool.query<LoginAttempt>(
    `SELECT id, username, user_id AS "userId", result, ip, user_agent AS "userAgent", created_at AS "createdAt"
       FROM login_attempts ORDER BY created_at DESC, id DESC LIMIT $1`,
    [limit],
  )
  return rows.map((r) => ({ ...r, id: Number(r.id) }))
}
