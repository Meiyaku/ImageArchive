import { mkdir } from 'node:fs/promises'
import { createApp } from './app.ts'
import { loadConfig } from './config.ts'
import { createPool, migrate } from './db.ts'
import { pruneLoginLog } from './loginLog.ts'
import { bootstrapAdmin } from './users.ts'

const config = loadConfig()
const pool = createPool(config.databaseUrl)

// Postgres may still be starting (pod scheduling, or `npm run dev` launching both at once).
for (let attempt = 1; ; attempt++) {
  try {
    await pool.query('SELECT 1')
    break
  } catch (err) {
    if (attempt >= 30) throw err
    console.log(`Waiting for database (${(err as Error).message})…`)
    await new Promise((r) => setTimeout(r, 2000))
  }
}

await migrate(pool)
await bootstrapAdmin(pool, config.adminUsername, config.adminPassword)
// Housekeeping now and daily: expired sessions, and sign-in log entries past retention.
const cleanUp = () =>
  Promise.all([pool.query('DELETE FROM sessions WHERE expires_at < now()'), pruneLoginLog(pool)])
await cleanUp()
setInterval(() => cleanUp().catch((err) => console.error('Cleanup failed:', err)), 86_400_000).unref()
await mkdir(config.uploadDir, { recursive: true })

const app = createApp({ pool, uploadDir: config.uploadDir, staticDir: config.staticDir })
const server = app.listen(config.port, () => console.log(`imagearchive listening on :${config.port}`))

const shutdown = () => {
  server.close(() => pool.end().then(() => process.exit(0)))
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
