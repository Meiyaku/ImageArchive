import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import sharp from 'sharp'
import { createApp } from './app.ts'
import { createPool, migrate, type Pool } from './db.ts'

/** Boots an in-memory Postgres (PGlite over the wire protocol) plus the app. */
export async function createTestContext() {
  const db = await PGlite.create()
  const server = new PGLiteSocketServer({ db, port: 0, host: '127.0.0.1' })
  await server.start()
  const pool: Pool = createPool(`postgres://postgres@${server.getServerConn()}/postgres`)
  await migrate(pool)
  const uploadDir = await mkdtemp(path.join(os.tmpdir(), 'imagearchive-test-'))
  const app = createApp({ pool, uploadDir })
  return {
    app,
    pool,
    uploadDir,
    async close() {
      await pool.end()
      await server.stop()
      await db.close()
      await rm(uploadDir, { recursive: true, force: true })
    },
  }
}

export function samplePng(width = 40, height = 30): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#3366cc' } }).png().toBuffer()
}
