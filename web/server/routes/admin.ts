import { Router } from 'express'
import type { Pool } from '../db.ts'
import { requireAdmin } from '../auth.ts'
import { recentLogins } from '../loginLog.ts'
import { hashPassword, MIN_PASSWORD_LENGTH } from '../password.ts'
import { deleteImages } from '../storage.ts'
import { createUser, USER_COLUMNS, ValidationError, type User } from '../users.ts'

export function adminRoutes(pool: Pool, uploadDir: string): Router {
  const router = Router()
  router.use(requireAdmin)

  router.get('/users', async (_req, res) => {
    const { rows } = await pool.query<User>(`SELECT ${USER_COLUMNS} FROM users ORDER BY lower(username)`)
    res.json({ users: rows })
  })

  router.get('/logins', async (_req, res) => {
    res.json({ attempts: await recentLogins(pool) })
  })

  router.post('/users', async (req, res) => {
    const { username, password, isAdmin } = req.body ?? {}
    try {
      const user = await createUser(pool, username, password, isAdmin === true)
      res.status(201).json({ user })
    } catch (err) {
      if (err instanceof ValidationError) return res.status(400).json({ error: err.message })
      throw err
    }
  })

  router.patch('/users/:id', async (req, res) => {
    const id = Number(req.params.id)
    const { password, isAdmin } = req.body ?? {}
    if (password !== undefined) {
      if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
        return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` })
      }
      await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [await hashPassword(password), id])
      // A reset signs the user out everywhere.
      await pool.query('DELETE FROM sessions WHERE user_id = $1', [id])
    }
    if (typeof isAdmin === 'boolean') {
      if (id === req.user!.id && !isAdmin) {
        return res.status(400).json({ error: "You can't remove your own admin rights" })
      }
      await pool.query('UPDATE users SET is_admin = $1 WHERE id = $2', [isAdmin, id])
    }
    const { rows } = await pool.query<User>(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [id])
    if (!rows[0]) return res.status(404).json({ error: 'User not found' })
    res.json({ user: rows[0] })
  })

  router.delete('/users/:id', async (req, res) => {
    const id = Number(req.params.id)
    if (id === req.user!.id) return res.status(400).json({ error: "You can't delete your own account" })
    const { rows: images } = await pool.query<{ image_key: string | null; thumb_key: string | null }>(
      `SELECT i.image_key, i.thumb_key FROM items i JOIN albums a ON a.id = i.album_id WHERE a.user_id = $1
       UNION ALL
       SELECT cover_image_key, cover_thumb_key FROM albums WHERE user_id = $1`,
      [id],
    )
    const { rowCount } = await pool.query('DELETE FROM users WHERE id = $1', [id])
    if (!rowCount) return res.status(404).json({ error: 'User not found' })
    await deleteImages(uploadDir, images.flatMap((i) => [i.image_key, i.thumb_key]))
    res.status(204).end()
  })

  return router
}
