import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // The Express API runs on :3000 in dev (npm run dev:api).
    proxy: { '/api': 'http://localhost:3000' },
  },
  test: {
    globals: true,
    projects: [
      {
        extends: true,
        test: {
          name: 'web',
          environment: 'jsdom',
          include: ['src/**/*.test.{ts,tsx}'],
          setupFiles: './src/test/setup.ts',
        },
      },
      {
        extends: true,
        test: {
          name: 'server',
          environment: 'node',
          include: ['server/**/*.test.ts'],
          // Each server test file boots its own in-memory Postgres.
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
})
