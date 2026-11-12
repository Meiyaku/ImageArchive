import type { Pool } from './db.ts'
import { hashPassword, MIN_PASSWORD_LENGTH } from './password.ts'

export interface User {
  id: number
  username: string
  isAdmin: boolean
  createdAt: string
}

export const USER_COLUMNS = 'id, username, is_admin AS "isAdmin", created_at AS "createdAt"'

export class ValidationError extends Error {}

export function validateCredentials(username: unknown, password: unknown): { username: string; password: string } {
  if (typeof username !== 'string' || !/^[A-Za-z0-9._@-]{2,64}$/.test(username.trim())) {
    throw new ValidationError('Username must be 2–64 characters: letters, numbers, . _ @ -')
  }
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new ValidationError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
  }
  return { username: username.trim(), password }
}

/** Throws ValidationError on bad input or a taken username. */
export async function createUser(pool: Pool, username: unknown, password: unknown, isAdmin = false): Promise<User> {
  const creds = validateCredentials(username, password)
  const hash = await hashPassword(creds.password)
  try {
    const { rows } = await pool.query<User>(
      `INSERT INTO users (username, password_hash, is_admin) VALUES ($1, $2, $3) RETURNING ${USER_COLUMNS}`,
      [creds.username, hash, isAdmin],
    )
    return rows[0]
  } catch (err) {
    if ((err as { code?: string }).code === '23505') throw new ValidationError('That username is already taken')
    throw err
  }
}

/** Creates the first admin from env vars when the users table is empty. */
export async function bootstrapAdmin(pool: Pool, username?: string, password?: string): Promise<void> {
  const { rows } = await pool.query<{ count: string }>('SELECT count(*) FROM users')
  if (Number(rows[0].count) > 0) return
  if (!username || !password) {
    console.warn('No users exist. Set ADMIN_USERNAME and ADMIN_PASSWORD, or run `npm run create-user -- --admin`.')
    return
  }
  await createUser(pool, username, password, true)
  console.log(`Created admin user "${username}"`)
}
