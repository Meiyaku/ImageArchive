import { readdir } from 'node:fs/promises'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import request from 'supertest'
import { cleanText, storyFileName } from './story.ts'
import { createTestContext, samplePng } from './testing.ts'
import { createUser } from './users.ts'

type Ctx = Awaited<ReturnType<typeof createTestContext>>
let ctx: Ctx

beforeAll(async () => {
  ctx = await createTestContext()
  await createUser(ctx.pool, 'alice', 'alice-password')
  await createUser(ctx.pool, 'bob', 'bob-password-1')
})
afterAll(() => ctx.close())

async function login(username: string, password: string) {
  const agent = request.agent(ctx.app)
  await agent.post('/api/auth/login').send({ username, password }).expect(200)
  return agent
}

const binary = (res: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = []
  res.on('data', (c: Buffer) => chunks.push(c))
  res.on('end', () => cb(null, Buffer.concat(chunks)))
}

/** Text of each page, via pdf.js (the same engine Firefox uses). */
async function pdfPages(data: Buffer): Promise<string[]> {
  const pdf = await getDocument({ data: new Uint8Array(data), useSystemFonts: false }).promise
  const pages: string[] = []
  for (let n = 1; n <= pdf.numPages; n++) {
    const content = await (await pdf.getPage(n)).getTextContent()
    pages.push(content.items.map((i) => ('str' in i ? i.str : '')).join(' ').replace(/\s+/g, ' '))
  }
  return pages
}

describe('album intro and cover photo', () => {
  it('edits name and intro independently', async () => {
    const alice = await login('alice', 'alice-password')
    const album = (await alice.post('/api/albums').send({ name: 'Trip' })).body.album
    expect(album).toMatchObject({ intro: '', coverImageKey: null })

    const withIntro = await alice.patch(`/api/albums/${album.id}`).send({ intro: '  Summer, 1998.  ' }).expect(200)
    expect(withIntro.body.album).toMatchObject({ name: 'Trip', intro: 'Summer, 1998.' })
    const renamed = await alice.patch(`/api/albums/${album.id}`).send({ name: 'Road trip' }).expect(200)
    expect(renamed.body.album).toMatchObject({ name: 'Road trip', intro: 'Summer, 1998.' })
    await alice.patch(`/api/albums/${album.id}`).send({ name: ' ' }).expect(400)
  })

  it('uploads, replaces, and removes a cover, cleaning up files', async () => {
    const alice = await login('alice', 'alice-password')
    const album = (await alice.post('/api/albums').send({ name: 'Covers' })).body.album

    const first = (await alice.put(`/api/albums/${album.id}/cover`).attach('image', await samplePng(), 'c.png').expect(200)).body.album
    expect(first.coverImageKey).toBeTruthy()
    expect((await alice.get(`/api/albums/${album.id}/cover/image`).expect(200)).headers['content-type']).toBe('image/jpeg')
    await alice.get(`/api/albums/${album.id}/cover/thumb`).expect(200)

    const second = (await alice.put(`/api/albums/${album.id}/cover`).attach('image', await samplePng(), 'd.png').expect(200)).body.album
    let files = await readdir(ctx.uploadDir)
    expect(files).not.toContain(first.coverImageKey)
    expect(files).toContain(second.coverImageKey)

    const removed = (await alice.delete(`/api/albums/${album.id}/cover`).expect(200)).body.album
    expect(removed.coverImageKey).toBeNull()
    files = await readdir(ctx.uploadDir)
    expect(files).not.toContain(second.coverImageKey)
    expect(files).not.toContain(second.coverThumbKey)
    await alice.get(`/api/albums/${album.id}/cover/image`).expect(404)

    await alice.put(`/api/albums/${album.id}/cover`).send({}).expect(400)
    await alice.put(`/api/albums/${album.id}/cover`).attach('image', Buffer.from('nope'), 'x.jpg').expect(400)
  })

  it('copies an item photo as the cover, independent of the item afterwards', async () => {
    const alice = await login('alice', 'alice-password')
    const album = (await alice.post('/api/albums').send({ name: 'From item' })).body.album
    const other = (await alice.post('/api/albums').send({ name: 'Other' })).body.album
    const item = (await alice.post(`/api/albums/${album.id}/items`).attach('image', await samplePng(), 'i.png')).body.item
    const otherItem = (await alice.post(`/api/albums/${other.id}/items`).attach('image', await samplePng(), 'j.png')).body.item

    const covered = (await alice.put(`/api/albums/${album.id}/cover`).send({ fromItemId: item.id }).expect(200)).body.album
    expect(covered.coverImageKey).not.toBe(item.imageKey)

    // Only photos from this album.
    await alice.put(`/api/albums/${album.id}/cover`).send({ fromItemId: otherItem.id }).expect(404)

    await alice.delete(`/api/items/${item.id}`).expect(204)
    await alice.get(`/api/albums/${album.id}/cover/image`).expect(200)
  })

  it("keeps covers private and deletes them with the album", async () => {
    const alice = await login('alice', 'alice-password')
    const bob = await login('bob', 'bob-password-1')
    const album = (await alice.post('/api/albums').send({ name: 'Mine' })).body.album
    const covered = (await alice.put(`/api/albums/${album.id}/cover`).attach('image', await samplePng(), 'c.png')).body.album

    await bob.get(`/api/albums/${album.id}/cover/image`).expect(404)
    await bob.put(`/api/albums/${album.id}/cover`).attach('image', await samplePng(), 'c.png').expect(404)
    await bob.delete(`/api/albums/${album.id}/cover`).expect(404)
    await bob.patch(`/api/albums/${album.id}`).send({ intro: 'hacked' }).expect(404)
    await bob.get(`/api/albums/${album.id}/story.pdf`).expect(404)

    await alice.delete(`/api/albums/${album.id}`).expect(204)
    expect(await readdir(ctx.uploadDir)).not.toContain(covered.coverImageKey)
  })
})

describe('story PDF', () => {
  it('renders items in sequence with titles and public notes, never private notes', async () => {
    const alice = await login('alice', 'alice-password')
    const album = (await alice.post('/api/albums').send({ name: 'Kitchen' })).body.album
    await alice.patch(`/api/albums/${album.id}`).send({ intro: 'Mum’s kitchen on Elm Street.' })
    await alice.put(`/api/albums/${album.id}/cover`).attach('image', await samplePng(), 'c.png')
    await alice.post(`/api/albums/${album.id}/items`).field('sequence', '2').field('title', 'Teapot')
      .field('publicNotes', 'Bought in Lisbon ☕').field('privateNotes', 'SECRET-PRICE')
      .attach('image', await samplePng(1200, 900), 'a.png').expect(201)
    await alice.post(`/api/albums/${album.id}/items`).field('sequence', '1')
      .field('publicNotes', 'An untitled first item').attach('image', await samplePng(900, 1200), 'b.png').expect(201)

    const res = await alice.get(`/api/albums/${album.id}/story.pdf?cover=1`).buffer(true).parse(binary).expect(200)
    expect(res.headers['content-type']).toBe('application/pdf')
    expect(res.headers['content-disposition']).toContain('Kitchen.pdf')
    expect(res.body.subarray(0, 5).toString()).toBe('%PDF-')

    const pages = await pdfPages(res.body)
    const all = pages.join(' | ')
    expect(pages[0]).toContain('Kitchen')
    expect(pages[0]).toContain('Mum’s kitchen on Elm Street.')
    expect(all).not.toContain('SECRET-PRICE')
    // Sequence 1 (untitled) comes before sequence 2.
    expect(all.indexOf('An untitled first item')).toBeLessThan(all.indexOf('Teapot'))
    expect(all).toContain('Bought in Lisbon')
    expect(all).not.toContain('☕')
    // Story pages are numbered from 1; the cover isn't.
    expect(pages[1]).toMatch(/\b1\b/)

    const noCover = await alice.get(`/api/albums/${album.id}/story.pdf`).buffer(true).parse(binary).expect(200)
    const noCoverPages = await pdfPages(noCover.body)
    expect(noCoverPages.length).toBeLessThan(pages.length)
    expect(noCoverPages[0]).toContain('Kitchen')
    expect(noCoverPages[0]).toContain('An untitled first item')
  })

  it('handles an empty album', async () => {
    const alice = await login('alice', 'alice-password')
    const album = (await alice.post('/api/albums').send({ name: 'Empty' })).body.album
    const res = await alice.get(`/api/albums/${album.id}/story.pdf`).buffer(true).parse(binary).expect(200)
    const pages = await pdfPages(res.body)
    expect(pages).toHaveLength(1)
    expect(pages[0]).toContain('This album has no items yet.')
  })
})

describe('story helpers', () => {
  it('drops characters the font cannot draw and keeps the rest', () => {
    expect(cleanText('Tea 🫖 time — “naïve” Ελληνικά', 'body')).toBe('Tea time — “naïve” Ελληνικά')
    expect(cleanText('a\r\nb', 'body')).toBe('a\nb')
  })

  it('makes a safe file name', () => {
    expect(storyFileName('Mum’s: Kitchen/2026')).toBe('Mum’s Kitchen2026.pdf')
    expect(storyFileName('   ')).toBe('Album.pdf')
  })
})
