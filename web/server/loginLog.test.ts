import request from 'supertest'
import { pruneLoginLog } from './loginLog.ts'
import { createTestContext } from './testing.ts'
import { createUser } from './users.ts'

type Ctx = Awaited<ReturnType<typeof createTestContext>>
let ctx: Ctx

beforeAll(async () => {
  ctx = await createTestContext()
  await createUser(ctx.pool, 'admin', 'admin-password', true)
  await createUser(ctx.pool, 'bob', 'bob-password')
})
afterAll(() => ctx.close())

const attempt = (username: string, password: string, ip: string) =>
  request(ctx.app)
    .post('/api/auth/login')
    .set('X-Forwarded-For', ip)
    .set('User-Agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1')
    .send({ username, password })

it('records successful, failed and unknown-user sign-ins with the client IP', async () => {
  await attempt('bob', 'wrong-password', '203.0.113.5').expect(401)
  await attempt('mallory', 'guess', '198.51.100.7').expect(401)
  await attempt('Bob', 'bob-password', '192.168.1.20').expect(200)

  const admin = request.agent(ctx.app)
  await admin.post('/api/auth/login').send({ username: 'admin', password: 'admin-password' }).expect(200)
  const { body } = await admin.get('/api/admin/logins').expect(200)
  const [adminLogin, bobOk, mallory, bobBad] = body.attempts

  expect(adminLogin).toMatchObject({ username: 'admin', result: 'success' })
  expect(bobOk).toMatchObject({ username: 'Bob', result: 'success', ip: '192.168.1.20', userId: expect.any(Number) })
  expect(bobOk.userAgent).toContain('iPhone')
  expect(mallory).toMatchObject({ username: 'mallory', result: 'failed', ip: '198.51.100.7', userId: null })
  // A wrong password for a real account is linked to that account.
  expect(bobBad).toMatchObject({ username: 'bob', result: 'failed', ip: '203.0.113.5', userId: bobOk.userId })
  // Passwords are never stored in the log.
  expect(JSON.stringify(body)).not.toContain('wrong-password')
})

it('is only visible to admins', async () => {
  const bob = request.agent(ctx.app)
  await bob.post('/api/auth/login').send({ username: 'bob', password: 'bob-password' }).expect(200)
  await bob.get('/api/admin/logins').expect(403)
  await request(ctx.app).get('/api/admin/logins').expect(401)
})

it('drops entries older than 90 days when pruned', async () => {
  await ctx.pool.query(
    `INSERT INTO login_attempts (username, result, created_at) VALUES ('old', 'failed', now() - interval '91 days')`,
  )
  await pruneLoginLog(ctx.pool)
  const { rows } = await ctx.pool.query(`SELECT 1 FROM login_attempts WHERE username = 'old'`)
  expect(rows).toHaveLength(0)
})
