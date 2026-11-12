import path from 'node:path'

export interface Config {
  databaseUrl: string
  uploadDir: string
  port: number
  staticDir: string | null
  adminUsername: string | undefined
  adminPassword: string | undefined
}

export function loadConfig(env = process.env): Config {
  const databaseUrl = env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL is required')
  return {
    databaseUrl,
    uploadDir: path.resolve(env.UPLOAD_DIR ?? './uploads'),
    port: Number(env.PORT ?? 3000),
    // Set in the container image; in dev Vite serves the client.
    staticDir: env.STATIC_DIR ? path.resolve(env.STATIC_DIR) : null,
    adminUsername: env.ADMIN_USERNAME,
    adminPassword: env.ADMIN_PASSWORD,
  }
}
