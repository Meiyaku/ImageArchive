// Local Postgres without Docker: PGlite (Postgres in WASM) on 127.0.0.1:5432,
// persisted in ./.devdb. Matches DATABASE_URL in .env.example.
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'

const port = Number(process.env.DEV_DB_PORT ?? 5432)
const db = await PGlite.create('./.devdb')
await db.exec(`DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'imagearchive') THEN
    CREATE ROLE imagearchive LOGIN SUPERUSER PASSWORD 'imagearchive';
  END IF; END $$;`)
const exists = await db.query(`SELECT 1 FROM pg_database WHERE datname = 'imagearchive'`)
if (!exists.rows.length) await db.exec('CREATE DATABASE imagearchive OWNER imagearchive')
const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1' })
await server.start()
console.log(`Dev Postgres (PGlite) listening on 127.0.0.1:${port}`)

process.on('SIGINT', async () => {
  await server.stop()
  await db.close()
  process.exit(0)
})
