import { readdir } from 'node:fs/promises'
import request from 'supertest'
import { createTestContext, samplePng } from './testing.ts'
import { migrate } from './db.ts'
import { createUser } from './users.ts'

type Ctx = Awaited<ReturnType<typeof createTestContext>>
let ctx: Ctx

beforeAll(async () => {
  ctx = await createTestContext()
  await createUser(ctx.pool, 'admin', 'admin-password', true)
  await createUser(ctx.pool, 'alice', 'alice-password')
  await createUser(ctx.pool, 'bob', 'bob-password-1')
})
afterAll(() => ctx.close())

async function login(username: string, password: string) {
  const agent = request.agent(ctx.app)
  await agent.post('/api/auth/login').send({ username, password }).expect(200)
  return agent
}

describe('auth', () => {
  it('rejects a wrong password and unauthenticated requests', async () => {
    await request(ctx.app).post('/api/auth/login').send({ username: 'alice', password: 'nope' }).expect(401)
    await request(ctx.app).get('/api/albums').expect(401)
    await request(ctx.app).get('/api/auth/me').expect(401)
  })

  it('logs in case-insensitively, sets an httpOnly cookie, and logs out', async () => {
    const agent = request.agent(ctx.app)
    const res = await agent.post('/api/auth/login').send({ username: 'ALICE', password: 'alice-password' }).expect(200)
    expect(res.body.user).toMatchObject({ username: 'alice', isAdmin: false })
    expect(res.headers['set-cookie'][0]).toMatch(/HttpOnly/)
    await agent.get('/api/auth/me').expect(200)
    await agent.post('/api/auth/logout').expect(204)
    await agent.get('/api/auth/me').expect(401)
  })

  it('rejects cross-origin writes', async () => {
    const agent = await login('alice', 'alice-password')
    await agent.post('/api/albums').set('Origin', 'https://evil.example').send({ name: 'x' }).expect(403)
  })
})

describe('admin', () => {
  it('only lets admins manage users', async () => {
    const alice = await login('alice', 'alice-password')
    await alice.get('/api/admin/users').expect(403)

    const admin = await login('admin', 'admin-password')
    const created = await admin.post('/api/admin/users').send({ username: 'carol', password: 'carol-password' }).expect(201)
    await admin.post('/api/admin/users').send({ username: 'Carol', password: 'carol-password' }).expect(400)
    await admin.post('/api/admin/users').send({ username: 'dave', password: 'short' }).expect(400)

    const list = await admin.get('/api/admin/users').expect(200)
    expect(list.body.users.map((u: { username: string }) => u.username)).toContain('carol')

    await admin.patch(`/api/admin/users/${created.body.user.id}`).send({ password: 'new-carol-password' }).expect(200)
    await login('carol', 'new-carol-password')
    await admin.delete(`/api/admin/users/${created.body.user.id}`).expect(204)
    await request(ctx.app).post('/api/auth/login').send({ username: 'carol', password: 'new-carol-password' }).expect(401)
  })

  it("won't let an admin delete themselves", async () => {
    const admin = await login('admin', 'admin-password')
    const me = await admin.get('/api/auth/me')
    await admin.delete(`/api/admin/users/${me.body.user.id}`).expect(400)
  })
})

describe('albums and items', () => {
  it('creates, renames, lists and deletes albums', async () => {
    const alice = await login('alice', 'alice-password')
    const { body } = await alice.post('/api/albums').send({ name: '  Holiday  ' }).expect(201)
    expect(body.album).toMatchObject({ name: 'Holiday', itemCount: 0 })
    await alice.post('/api/albums').send({ name: '   ' }).expect(400)

    await alice.patch(`/api/albums/${body.album.id}`).send({ name: 'Summer 2026' }).expect(200)
    const list = await alice.get('/api/albums').expect(200)
    expect(list.body.albums.map((a: { name: string }) => a.name)).toContain('Summer 2026')

    await alice.delete(`/api/albums/${body.album.id}`).expect(204)
    await alice.get(`/api/albums/${body.album.id}`).expect(404)
  })

  it("hides one user's albums and items from another", async () => {
    const alice = await login('alice', 'alice-password')
    const bob = await login('bob', 'bob-password-1')
    const album = (await alice.post('/api/albums').send({ name: 'Private' })).body.album
    const item = (await alice.post(`/api/albums/${album.id}/items`).attach('image', await samplePng(), 'a.png')).body.item

    expect((await bob.get('/api/albums')).body.albums).toEqual([])
    await bob.get(`/api/albums/${album.id}`).expect(404)
    await bob.patch(`/api/albums/${album.id}`).send({ name: 'Mine now' }).expect(404)
    await bob.delete(`/api/albums/${album.id}`).expect(404)
    await bob.get(`/api/albums/${album.id}/items`).expect(404)
    await bob.post(`/api/albums/${album.id}/items`).attach('image', await samplePng(), 'b.png').expect(404)
    await bob.get(`/api/items/${item.id}`).expect(404)
    await bob.get(`/api/items/${item.id}/image`).expect(404)
    await bob.delete(`/api/items/${item.id}`).expect(404)
  })

  it('uploads an image with notes, edits it, replaces the image, and cleans up files', async () => {
    const alice = await login('alice', 'alice-password')
    const album = (await alice.post('/api/albums').send({ name: 'Uploads' })).body.album

    await alice.post(`/api/albums/${album.id}/items`).field('publicNotes', 'x').expect(400)
    await alice.post(`/api/albums/${album.id}/items`).attach('image', Buffer.from('not an image'), 'x.jpg').expect(400)

    const created = await alice
      .post(`/api/albums/${album.id}/items`)
      .field('publicNotes', 'A blue square')
      .field('privateNotes', 'bought for $5')
      .attach('image', await samplePng(4000, 3000), { filename: 'IMG_0001.png', contentType: 'image/png' })
      .expect(201)
    const item = created.body.item
    expect(item).toMatchObject({ publicNotes: 'A blue square', privateNotes: 'bought for $5' })

    const image = await alice.get(`/api/items/${item.id}/image`).expect(200)
    expect(image.headers['content-type']).toBe('image/jpeg')
    await alice.get(`/api/items/${item.id}/thumb`).expect(200)

    const listed = await alice.get(`/api/albums/${album.id}`).expect(200)
    expect(listed.body.album).toMatchObject({ itemCount: 1, firstItemId: item.id })

    const edited = await alice.patch(`/api/items/${item.id}`).field('privateNotes', 'gift').expect(200)
    expect(edited.body.item).toMatchObject({ publicNotes: 'A blue square', privateNotes: 'gift' })

    const replaced = await alice.patch(`/api/items/${item.id}`).attach('image', await samplePng(), 'new.png').expect(200)
    expect(replaced.body.item.imageKey).not.toBe(item.imageKey)
    const files = await readdir(ctx.uploadDir)
    expect(files).not.toContain(item.imageKey)
    expect(files).toContain(replaced.body.item.imageKey)

    await alice.delete(`/api/albums/${album.id}`).expect(204)
    const after = await readdir(ctx.uploadDir)
    expect(after).not.toContain(replaced.body.item.imageKey)
    expect(after).not.toContain(replaced.body.item.thumbKey)
  })
})

describe('item sequence', () => {
  it('counts up from 1 by default, honours given values, and sorts the album by sequence', async () => {
    const alice = await login('alice', 'alice-password')
    const album = (await alice.post('/api/albums').send({ name: 'Ordered' })).body.album
    expect(album.nextSequence).toBe(1)
    const add = async (sequence?: string) => {
      const req = alice.post(`/api/albums/${album.id}/items`)
      if (sequence !== undefined) req.field('sequence', sequence)
      return (await req.attach('image', await samplePng(), 'x.png').expect(201)).body.item
    }

    const first = await add()
    const second = await add('')
    expect([first.sequence, second.sequence]).toEqual([1, 2])
    const tenth = await add('10')
    const zero = await add('0')
    const afterTen = await add()
    expect(afterTen.sequence).toBe(11)

    const list = await alice.get(`/api/albums/${album.id}/items`).expect(200)
    expect(list.body.items.map((i: { id: number }) => i.id)).toEqual([zero.id, first.id, second.id, tenth.id, afterTen.id])
    const meta = (await alice.get(`/api/albums/${album.id}`)).body.album
    expect(meta).toMatchObject({ nextSequence: 12, firstItemId: zero.id })

    // Editing: a new value re-sorts; omitting it leaves it alone.
    const moved = await alice.patch(`/api/items/${first.id}`).field('sequence', '20').expect(200)
    expect(moved.body.item.sequence).toBe(20)
    const notesOnly = await alice.patch(`/api/items/${first.id}`).field('publicNotes', 'hi').expect(200)
    expect(notesOnly.body.item.sequence).toBe(20)
    const reordered = await alice.get(`/api/albums/${album.id}/items`)
    expect(reordered.body.items.at(-1).id).toBe(first.id)
  })

  it('rejects non-integer sequences without storing the upload', async () => {
    const alice = await login('alice', 'alice-password')
    const album = (await alice.post('/api/albums').send({ name: 'Bad seq' })).body.album
    const before = await readdir(ctx.uploadDir)
    for (const bad of ['-1', '1.5', 'abc', '99999999999']) {
      await alice.post(`/api/albums/${album.id}/items`).field('sequence', bad)
        .attach('image', await samplePng(), 'x.png').expect(400)
    }
    expect(await readdir(ctx.uploadDir)).toEqual(before)
  })
})

describe('002 migration backfill', () => {
  it('numbers existing items per album in the order they were added', async () => {
    const db = await createTestContext()
    try {
      await db.pool.query(`DELETE FROM schema_migrations WHERE name = '002_item_sequence.sql'`)
      await db.pool.query('DROP INDEX items_album_sequence_idx')
      await db.pool.query('ALTER TABLE items DROP COLUMN sequence')
      const u = await createUser(db.pool, 'old', 'old-password')
      const { rows: [a, b] } = await db.pool.query<{ id: number }>(
        'INSERT INTO albums (user_id, name) VALUES ($1, $2), ($1, $3) RETURNING id', [u.id, 'A', 'B'])
      await db.pool.query(
        `INSERT INTO items (album_id, created_at) VALUES ($1, '2026-01-02'), ($1, '2026-01-01'), ($2, '2026-01-03')`,
        [a.id, b.id])
      await migrate(db.pool)
      const { rows } = await db.pool.query('SELECT album_id, sequence, created_at FROM items ORDER BY album_id, sequence')
      expect(rows.map((r) => [r.album_id, r.sequence])).toEqual([[a.id, 1], [a.id, 2], [b.id, 1]])
      expect(new Date(rows[0].created_at).toISOString()).toMatch(/^2026-01-01/)
    } finally {
      await db.close()
    }
  })
})

describe('item title', () => {
  it('is optional, trimmed, capped, and editable (including clearing it)', async () => {
    const alice = await login('alice', 'alice-password')
    const album = (await alice.post('/api/albums').send({ name: 'Titles' })).body.album
    const untitled = (await alice.post(`/api/albums/${album.id}/items`)
      .attach('image', await samplePng(), 'x.png').expect(201)).body.item
    expect(untitled.title).toBe('')

    const titled = (await alice.post(`/api/albums/${album.id}/items`).field('title', '  Grandma\'s quilt  ')
      .attach('image', await samplePng(), 'x.png').expect(201)).body.item
    expect(titled.title).toBe("Grandma's quilt")

    const long = await alice.patch(`/api/items/${untitled.id}`).field('title', 'x'.repeat(300)).expect(200)
    expect(long.body.item.title).toHaveLength(200)

    const notesOnly = await alice.patch(`/api/items/${titled.id}`).field('publicNotes', 'n').expect(200)
    expect(notesOnly.body.item.title).toBe("Grandma's quilt")
    const cleared = await alice.patch(`/api/items/${titled.id}`).field('title', '').expect(200)
    expect(cleared.body.item.title).toBe('')
  })
})
