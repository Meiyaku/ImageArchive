import { Router } from 'express'
import type { Pool } from '../db.ts'
import { createSession, destroySession, requireUser, sessionTokenHash } from '../auth.ts'
import { recordLogin } from '../loginLog.ts'
import { LoginThrottle, TooManyAttemptsError, type LoginThrottleOptions } from '../loginThrottle.ts'
import { hashPassword, MIN_PASSWORD_LENGTH, verifyPassword } from '../password.ts'
import { USER_COLUMNS, type User } from '../users.ts'

// Checked against when the username doesn't exist, so a wrong username takes as long
// as a wrong password and response times don't reveal which accounts exist.
let dummyHash: Promise<string> | null = null
const getDummyHash = () => (dummyHash ??= hashPassword('not-a-real-password'))

export function authRoutes(pool: Pool, throttleOptions?: LoginThrottleOptions): Router {
  const router = Router()
  const throttle = new LoginThrottle(throttleOptions)

  router.post('/login', async (req, res) => {
    const { username, password } = req.body ?? {}
    if (typeof username !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Username and password are required' })
    }
    const name = username.trim().slice(0, 100)
    let row: (User & { passwordHash: string }) | undefined
    try {
      const ok = await throttle.run(name.toLowerCase(), async () => {
        const { rows } = await pool.query<User & { passwordHash: string }>(
          `SELECT ${USER_COLUMNS}, password_hash AS "passwordHash" FROM users WHERE lower(username) = lower($1)`,
          [name],
        )
        row = rows[0]
        const valid = await verifyPassword(password, row?.passwordHash ?? (await getDummyHash()))
        return !!row && valid
      })
      if (!ok || !row) {
        await recordLogin(pool, req, name, 'failed', row?.id ?? null)
        return res.status(401).json({ error: 'Incorrect username or password' })
      }
    } catch (err) {
      if (err instanceof TooManyAttemptsError) {
        await recordLogin(pool, req, name, 'throttled', null)
        return res.status(429).json({ error: 'Too many sign-in attempts. Wait a moment and try again.' })
      }
      throw err
    }
    await recordLogin(pool, req, name, 'success', row.id)
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
    // Sign out every other device; this one stays signed in.
    await pool.query('DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2', [
      req.user!.id, sessionTokenHash(req) ?? '',
    ])
    res.status(204).end()
  })

  return router
}
