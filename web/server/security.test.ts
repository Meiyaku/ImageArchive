import { crc32, deflateSync } from 'node:zlib'
import request from 'supertest'
import { LoginThrottle, TooManyAttemptsError } from './loginThrottle.ts'
import { createTestContext, samplePng } from './testing.ts'
import { createUser } from './users.ts'

type Ctx = Awaited<ReturnType<typeof createTestContext>>
let ctx: Ctx

beforeAll(async () => {
  ctx = await createTestContext()
  await createUser(ctx.pool, 'alice', 'alice-password')
})
afterAll(() => ctx.close())

async function login(username = 'alice', password = 'alice-password') {
  const agent = request.agent(ctx.app)
  await agent.post('/api/auth/login').send({ username, password }).expect(200)
  return agent
}

/** A tiny PNG whose header claims width×height: a "decompression bomb" shape. */
function pngClaiming(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.alloc(16))), chunk('IEND', Buffer.alloc(0)),
  ])
}

describe('image upload limits', () => {
  it('rejects images over 100 megapixels before decoding them', async () => {
    const alice = await login()
    const album = (await alice.post('/api/albums').send({ name: 'Bombs' })).body.album
    const res = await alice.post(`/api/albums/${album.id}/items`)
      .attach('image', pngClaiming(12_000, 12_000), 'bomb.png').expect(400)
    expect(res.body.error).toBe('That image is too large (max 100 megapixels)')
  })

  it('rejects non-photo formats such as SVG', async () => {
    const alice = await login()
    const album = (await alice.post('/api/albums').send({ name: 'Formats' })).body.album
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>')
    const res = await alice.post(`/api/albums/${album.id}/items`).attach('image', svg, 'x.svg').expect(400)
    expect(res.body.error).toMatch(/Please choose a photo/)
    await alice.put(`/api/albums/${album.id}/cover`).attach('image', svg, 'x.svg').expect(400)
    // Ordinary photos still work.
    await alice.post(`/api/albums/${album.id}/items`).attach('image', await samplePng(), 'ok.png').expect(201)
  })
})

describe('login', () => {
  it("takes about as long for an unknown username as for a wrong password", async () => {
    const median = async (username: string) => {
      const times: number[] = []
      for (let i = 0; i < 3; i++) {
        const start = performance.now()
        await request(ctx.app).post('/api/auth/login').send({ username, password: `wrong-${i}` }).expect(401)
        times.push(performance.now() - start)
      }
      return times.sort((a, b) => a - b)[1]
    }
    const unknown = await median(`nobody-${Date.now()}`)
    const known = await median('alice')
    // Before the fix an unknown user answered ~20x faster.
    expect(unknown).toBeGreaterThan(known * 0.5)
  })

  it('treats an unparseable Origin as cross-origin instead of erroring', async () => {
    await request(ctx.app).post('/api/auth/login').set('Origin', 'null')
      .send({ username: 'alice', password: 'alice-password' }).expect(403)
  })
})

describe('password change', () => {
  it('signs out other devices but keeps this one signed in', async () => {
    await createUser(ctx.pool, 'carol', 'carol-password')
    const phone = await login('carol', 'carol-password')
    const laptop = await login('carol', 'carol-password')
    await phone.post('/api/auth/password').send({ currentPassword: 'carol-password', newPassword: 'carol-new-password' }).expect(204)
    await phone.get('/api/auth/me').expect(200)
    await laptop.get('/api/auth/me').expect(401)
  })
})

describe('security headers', () => {
  it('sends CSP, anti-framing and nosniff headers on pages and API responses', async () => {
    const res = await request(ctx.app).get('/api/auth/me')
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'")
    expect(res.headers['content-security-policy']).toContain("default-src 'self'")
    expect(res.headers['x-frame-options']).toBe('DENY')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['referrer-policy']).toBe('same-origin')
    // HSTS only once the site is reached over HTTPS.
    expect(res.headers['strict-transport-security']).toBeUndefined()
    const https = await request(ctx.app).get('/api/auth/me').set('X-Forwarded-Proto', 'https')
    expect(https.headers['strict-transport-security']).toBe('max-age=31536000')
  })
})

describe('LoginThrottle', () => {
  const fast = { freeFailures: 2, baseDelayMs: 40, maxDelayMs: 160, maxPending: 3 }

  it('adds growing delays after a few failures, capped, and resets on success', () => {
    const t = new LoginThrottle(fast)
    expect([0, 1, 2, 3, 4, 5, 9].map((n) => t.delayFor(n))).toEqual([0, 0, 40, 80, 160, 160, 160])
  })

  it('serialises parallel attempts for one username so they all wait', async () => {
    const t = new LoginThrottle({ ...fast, maxPending: 10 })
    for (let i = 0; i < 2; i++) await t.run('victim', async () => false)
    const start = performance.now()
    await Promise.all([1, 2, 3].map(() => t.run('victim', async () => false)))
    // Delays of 40 + 80 + 160 run back to back rather than overlapping.
    expect(performance.now() - start).toBeGreaterThanOrEqual(270)
  })

  it("never locks the real user out: a correct password still works mid-attack", async () => {
    const t = new LoginThrottle(fast)
    for (let i = 0; i < 6; i++) await t.run('victim', async () => false)
    expect(await t.run('victim', async () => true)).toBe(true)
    expect(t.delayFor(0)).toBe(0)
    expect(t.size).toBe(0)
  })

  it('rejects when too many attempts are queued for one username', async () => {
    const t = new LoginThrottle(fast)
    for (let i = 0; i < 4; i++) await t.run('victim', async () => false)
    const queued = [1, 2, 3].map(() => t.run('victim', async () => false))
    await expect(t.run('victim', async () => false)).rejects.toBeInstanceOf(TooManyAttemptsError)
    // Other usernames are unaffected.
    expect(await t.run('someone-else', async () => true)).toBe(true)
    await Promise.all(queued)
  })

  it('keeps memory bounded however many usernames are tried', async () => {
    const t = new LoginThrottle({ ...fast, maxKeys: 50 })
    for (let i = 0; i < 500; i++) await t.run(`made-up-${i}`, async () => false)
    expect(t.size).toBeLessThanOrEqual(50)
  })
})
