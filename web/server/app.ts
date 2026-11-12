import path from 'node:path'
import cookieParser from 'cookie-parser'
import express, { type ErrorRequestHandler } from 'express'
import multer from 'multer'
import type { Pool } from './db.ts'
import { checkOrigin, loadUser, requireUser } from './auth.ts'
import { adminRoutes } from './routes/admin.ts'
import { albumRoutes } from './routes/albums.ts'
import { authRoutes } from './routes/auth.ts'
import { itemRoutes } from './routes/items.ts'

export interface AppOptions {
  pool: Pool
  uploadDir: string
  staticDir?: string | null
}

export function createApp({ pool, uploadDir, staticDir }: AppOptions): express.Express {
  const app = express()
  // Behind Traefik: trust X-Forwarded-* so req.secure / req.ip are right.
  app.set('trust proxy', 1)
  app.disable('x-powered-by')

  app.get('/healthz', async (_req, res) => {
    await pool.query('SELECT 1')
    res.type('text').send('ok')
  })

  const api = express.Router()
  api.use(express.json({ limit: '100kb' }))
  api.use(cookieParser())
  api.use(checkOrigin)
  api.use(loadUser(pool))
  api.use('/auth', authRoutes(pool))
  api.use('/admin', adminRoutes(pool, uploadDir))
  api.use('/albums', requireUser, albumRoutes(pool, uploadDir))
  api.use('/', requireUser, itemRoutes(pool, uploadDir))
  api.use((_req, res) => res.status(404).json({ error: 'Not found' }))
  app.use('/api', api)

  if (staticDir) {
    app.use(express.static(staticDir, {
      index: false,
      setHeaders: (res, filePath) => {
        // Vite fingerprints everything under assets/.
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
        }
      },
    }))
    // Client-side routes fall back to the SPA shell.
    app.get('/{*splat}', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache')
      res.sendFile(path.join(staticDir, 'index.html'))
    })
  }

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof multer.MulterError) {
      const message = err.code === 'LIMIT_FILE_SIZE' ? 'That image is too large (max 30 MB)' : err.message
      return res.status(400).json({ error: message })
    }
    const status = typeof err.status === 'number' ? err.status : 500
    if (status >= 500) console.error(err)
    res.status(status).json({ error: status >= 500 ? 'Something went wrong' : err.message })
  }
  app.use(onError)
  return app
}
