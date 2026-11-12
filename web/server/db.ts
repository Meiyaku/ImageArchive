import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import pg from 'pg'

export type Pool = pg.Pool

export function createPool(connectionString: string): Pool {
  return new pg.Pool({ connectionString, max: 10 })
}

const MIGRATIONS_DIR = path.join(import.meta.dirname, 'migrations')

/**
 * Applies any `migrations/NNN_*.sql` files not yet recorded in schema_migrations,
 * each in its own transaction. An advisory lock keeps concurrent pods from racing.
 */
export async function migrate(pool: Pool): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('SELECT pg_advisory_lock(727274)')
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`)
    const { rows } = await client.query<{ name: string }>('SELECT name FROM schema_migrations')
    const applied = new Set(rows.map((r) => r.name))
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort()
    for (const file of files) {
      if (applied.has(file)) continue
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8')
      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file])
        await client.query('COMMIT')
        console.log(`Applied migration ${file}`)
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(727274)').catch(() => {})
    client.release()
  }
}
