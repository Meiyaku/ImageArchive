import request from 'supertest'
import { pruneLoginLog } from './loginLog.ts'
import { ConcurrencyLimit, TooManyAttemptsError } from './loginThrottle.ts'
import { createTestContext } from './testing.ts'
import { createUser } from './users.ts'

type Ctx = Awaited<ReturnType<typeof createTestContext>>
let ctx: Ctx

const fast = { freeFailures: 2, baseDelayMs: 60, maxDelayMs: 240, maxPending: 3 }

beforeAll(async () => {
  ctx = await createTestContext({ authLimits: { ip: { ...fast, resetOnSuccess: false }, passwordChange: fast } })
  await createUser(ctx.pool, 'alice', 'alice-password')
  await createUser(ctx.pool, 'dave', 'dave-password')
})
afterAll(() => ctx.close())

let n = 0
const fromIp = (ip: string, username = `made-up-${n++}`, password = 'guess') =>
  request(ctx.app).post('/api/auth/login').set('X-Forwarded-For', ip).send({ username, password })

const timed = async (fn: () => Promise<unknown>) => {
  const start = performance.now()
  await fn()
  return performance.now() - start
}

describe('per-IP sign-in throttle', () => {
  it('slows one address trying many usernames, without affecting other addresses', async () => {
    for (let i = 0; i < 4; i++) await fromIp('203.0.113.1').expect(401)
    const attacker = await timed(() => fromIp('203.0.113.1').expect(401))
    const bystander = await timed(() => fromIp('198.51.100.1').expect(401))
    // The attacker's 5th failure waits the 240 ms cap; the bystander's first doesn't wait.
    expect(attacker - bystander).toBeGreaterThan(150)
  })

  it("isn't reset by signing into an account of one's own", async () => {
    for (let i = 0; i < 4; i++) await fromIp('203.0.113.2').expect(401)
    await fromIp('203.0.113.2', 'alice', 'alice-password').expect(200)
    const after = await timed(() => fromIp('203.0.113.2').expect(401))
    const fresh = await timed(() => fromIp('198.51.100.2').expect(401))
    expect(after - fresh).toBeGreaterThan(150)
  })

  it('answers 429 and logs it when too many attempts from one address are queued', async () => {
    for (let i = 0; i < 2; i++) await fromIp('203.0.113.3').expect(401)
    const statuses = (await Promise.all([1, 2, 3, 4, 5].map(() => fromIp('203.0.113.3')))).map((r) => r.status)
    expect(statuses).toContain(429)
    const { rows } = await ctx.pool.query(`SELECT 1 FROM login_attempts WHERE ip = '203.0.113.3' AND result = 'throttled'`)
    expect(rows.length).toBeGreaterThan(0)
  })
})

describe('password change', () => {
  it('throttles guesses at the current password from a signed-in session', async () => {
    const agent = request.agent(ctx.app)
    await agent.post('/api/auth/login').send({ username: 'dave', password: 'dave-password' }).expect(200)
    const change = (currentPassword: string) =>
      agent.post('/api/auth/password').send({ currentPassword, newPassword: 'dave-new-password' })
    for (let i = 0; i < 2; i++) await change('wrong').expect(400)
    const statuses = (await Promise.all([1, 2, 3, 4, 5].map(() => change('wrong')))).map((r) => r.status)
    expect(statuses).toContain(429)
    // The real password still works.
    await change('dave-password').expect(204)
  })
})

describe('ConcurrencyLimit', () => {
  it('never runs more than the limit at once, and rejects beyond the queue', async () => {
    const limit = new ConcurrencyLimit(2, 3)
    let running = 0
    let peak = 0
    const task = async () => {
      running++
      peak = Math.max(peak, running)
      await new Promise((r) => setTimeout(r, 20))
      running--
    }
    const accepted = [1, 2, 3, 4, 5].map(() => limit.run(task))
    expect(limit.running).toBe(2)
    expect(limit.waiting).toBe(3)
    await expect(limit.run(task)).rejects.toBeInstanceOf(TooManyAttemptsError)
    await Promise.all(accepted)
    expect(peak).toBe(2)
    expect(limit.running).toBe(0)
  })

  it('frees its slot when a task throws', async () => {
    const limit = new ConcurrencyLimit(1, 0)
    await expect(limit.run(async () => { throw new Error('boom') })).rejects.toThrow('boom')
    expect(await limit.run(async () => 'ok')).toBe('ok')
  })
})

describe('sign-in log size', () => {
  it('keeps only the newest entries beyond the row cap', async () => {
    await ctx.pool.query(
      `INSERT INTO login_attempts (username, result) SELECT 'flood-' || g, 'failed' FROM generate_series(1, 50) g`,
    )
    await pruneLoginLog(ctx.pool, 10)
    const { rows } = await ctx.pool.query<{ username: string }>('SELECT username FROM login_attempts ORDER BY id')
    expect(rows).toHaveLength(10)
    expect(rows.at(-1)!.username).toBe('flood-50')
  })
})
