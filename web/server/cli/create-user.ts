// Usage: npm run create-user -- <username> <password> [--admin]
// In the cluster: kubectl -n imagearchive exec deploy/imagearchive -- node server/cli/create-user.ts <user> <pass> --admin
import { loadConfig } from '../config.ts'
import { createPool, migrate } from '../db.ts'
import { createUser } from '../users.ts'

const args = process.argv.slice(2)
const isAdmin = args.includes('--admin')
const [username, password] = args.filter((a) => a !== '--admin')
if (!username || !password) {
  console.error('Usage: create-user <username> <password> [--admin]')
  process.exit(1)
}

const pool = createPool(loadConfig().databaseUrl)
try {
  await migrate(pool)
  const user = await createUser(pool, username, password, isAdmin)
  console.log(`Created ${user.isAdmin ? 'admin' : 'user'} "${user.username}" (id ${user.id})`)
} catch (err) {
  console.error((err as Error).message)
  process.exitCode = 1
} finally {
  await pool.end()
}
