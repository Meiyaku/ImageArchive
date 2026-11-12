import { Router } from 'express'
import type { Pool } from '../db.ts'
import { createSession, destroySession, LoginLimiter, requireUser } from '../auth.ts'
import { hashPassword, MIN_PASSWORD_LENGTH, verifyPassword } from '../password.ts'
import { USER_COLUMNS, type User } from '../users.ts'

export function authRoutes(pool: Pool): Router {
  const router = Router()
  const limiter = new LoginLimiter()

  router.post('/login', async (req, res) => {
    const { username, password } = req.body ?? {}
    if (typeof username !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Username and password are required' })
    }
    const key = `${req.ip}|${username.trim().toLowerCase()}`
    if (limiter.isBlocked(key)) {
      return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' })
    }
    const { rows } = await pool.query<User & { passwordHash: string }>(
      `SELECT ${USER_COLUMNS}, password_hash AS "passwordHash" FROM users WHERE lower(username) = lower($1)`,
      [username.trim()],
    )
    const row = rows[0]
    if (!row || !(await verifyPassword(password, row.passwordHash))) {
      limiter.fail(key)
      return res.status(401).json({ error: 'Incorrect username or password' })
    }
    limiter.reset(key)
    await createSession(pool, req, res, row.id)
    const { passwordHash: _, ...user } = row
    res.json({ user })
  })

  router.post('/logout', async (req, res) => {
    await destroySession(pool, req, res)
    res.status(204).end()
  })

  router.get('/me', requireUser, (req, res) => {
    res.json({ user: req.user })
  })

  router.post('/password', requireUser, async (req, res) => {
    const { currentPassword, newPassword } = req.body ?? {}
    if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` })
    }
    const { rows } = await pool.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [
      req.user!.id,
    ])
    if (typeof currentPassword !== 'string' || !(await verifyPassword(currentPassword, rows[0].password_hash))) {
      return res.status(400).json({ error: 'Current password is incorrect' })
    }
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [await hashPassword(newPassword), req.user!.id])
    res.status(204).end()
  })

  return router
}
