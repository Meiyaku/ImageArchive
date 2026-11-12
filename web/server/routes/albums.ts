import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { Router, type Request } from 'express'
import type { Pool } from '../db.ts'
import { deleteImages } from '../storage.ts'
import { renderStory, storyFileName } from '../story.ts'
import { storeImageOr400, storeUpload, upload } from '../upload.ts'

export interface Album {
  id: number
  name: string
  intro: string
  itemCount: number
  /** The album's own cover photo; null when none is set. */
  coverImageKey: string | null
  coverThumbKey: string | null
  /** First item by sequence; the album-list thumbnail falls back to it when there's no cover. */
  firstItemId: number | null
  firstItemThumbKey: string | null
  /** What a new item gets if no sequence is given. */
  nextSequence: number
  createdAt: string
  updatedAt: string
}

const ALBUM_SELECT = `
  SELECT a.id, a.name, a.intro, a.created_at AS "createdAt", a.updated_at AS "updatedAt",
         a.cover_image_key AS "coverImageKey", a.cover_thumb_key AS "coverThumbKey",
         (SELECT count(*)::int FROM items i WHERE i.album_id = a.id) AS "itemCount",
         (SELECT COALESCE(max(i.sequence), 0) + 1 FROM items i WHERE i.album_id = a.id) AS "nextSequence",
         first.id AS "firstItemId", first.thumb_key AS "firstItemThumbKey"
    FROM albums a
    LEFT JOIN LATERAL (
      SELECT i.id, i.thumb_key FROM items i
       WHERE i.album_id = a.id AND i.thumb_key IS NOT NULL
       ORDER BY i.sequence, i.id LIMIT 1
    ) first ON TRUE`

export const MAX_INTRO = 5_000

export function parseName(name: unknown): string | null {
  if (typeof name !== 'string') return null
  const trimmed = name.trim()
  return trimmed.length >= 1 && trimmed.length <= 200 ? trimmed : null
}

export function albumRoutes(pool: Pool, uploadDir: string): Router {
  const router = Router()

  const ownedAlbum = async (req: Request): Promise<Album | undefined> => {
    const { rows } = await pool.query<Album>(`${ALBUM_SELECT} WHERE a.id = $1 AND a.user_id = $2`, [
      Number(req.params.id), req.user!.id,
    ])
    return rows[0]
  }

  const reload = async (id: number): Promise<Album> =>
    (await pool.query<Album>(`${ALBUM_SELECT} WHERE a.id = $1`, [id])).rows[0]

  router.get('/', async (req, res) => {
    const { rows } = await pool.query<Album>(
      `${ALBUM_SELECT} WHERE a.user_id = $1 ORDER BY lower(a.name), a.id`,
      [req.user!.id],
    )
    res.json({ albums: rows })
  })

  router.post('/', async (req, res) => {
    const name = parseName(req.body?.name)
    if (!name) return res.status(400).json({ error: 'Album name is required (max 200 characters)' })
    const { rows } = await pool.query<{ id: number }>(
      'INSERT INTO albums (user_id, name) VALUES ($1, $2) RETURNING id',
      [req.user!.id, name],
    )
    res.status(201).json({ album: await reload(rows[0].id) })
  })

  router.get('/:id', async (req, res) => {
    const album = await ownedAlbum(req)
    if (!album) return res.status(404).json({ error: 'Album not found' })
    res.json({ album })
  })

  /** Body: { name?, intro? } — omitted fields are left unchanged. */
  router.patch('/:id', async (req, res) => {
    const { name: rawName, intro: rawIntro } = req.body ?? {}
    const name = rawName === undefined ? null : parseName(rawName)
    if (rawName !== undefined && !name) {
      return res.status(400).json({ error: 'Album name is required (max 200 characters)' })
    }
    const intro = typeof rawIntro === 'string' ? rawIntro.trim().slice(0, MAX_INTRO) : null
    const { rowCount } = await pool.query(
      `UPDATE albums SET name = COALESCE($1, name), intro = COALESCE($2, intro), updated_at = now()
        WHERE id = $3 AND user_id = $4`,
      [name, intro, Number(req.params.id), req.user!.id],
    )
    if (!rowCount) return res.status(404).json({ error: 'Album not found' })
    res.json({ album: await reload(Number(req.params.id)) })
  })

  router.delete('/:id', async (req, res) => {
    const album = await ownedAlbum(req)
    if (!album) return res.status(404).json({ error: 'Album not found' })
    const { rows: images } = await pool.query<{ image_key: string | null; thumb_key: string | null }>(
      'SELECT image_key, thumb_key FROM items WHERE album_id = $1',
      [album.id],
    )
    await pool.query('DELETE FROM albums WHERE id = $1', [album.id])
    await deleteImages(uploadDir, [
      album.coverImageKey, album.coverThumbKey, ...images.flatMap((i) => [i.image_key, i.thumb_key]),
    ])
    res.status(204).end()
  })

  /**
   * Sets the cover from either a multipart `image` upload or JSON { fromItemId }.
   * Choosing an item copies its image, so the cover survives the item being changed or deleted.
   */
  router.put('/:id/cover', upload.single('image'), async (req, res) => {
    const album = await ownedAlbum(req)
    if (!album) return res.status(404).json({ error: 'Album not found' })

    let stored = await storeUpload(req, uploadDir)
    if (!stored) {
      const fromItemId = Number(req.body?.fromItemId)
      if (!Number.isInteger(fromItemId)) {
        return res.status(400).json({ error: 'Send an image or choose a photo from the album' })
      }
      const { rows } = await pool.query<{ image_key: string | null }>(
        'SELECT image_key FROM items WHERE id = $1 AND album_id = $2',
        [fromItemId, album.id],
      )
      if (!rows[0]?.image_key) return res.status(404).json({ error: 'That photo is not in this album' })
      stored = await storeImageOr400(uploadDir, await readFile(path.join(uploadDir, path.basename(rows[0].image_key))))
    }

    await pool.query(
      'UPDATE albums SET cover_image_key = $1, cover_thumb_key = $2, updated_at = now() WHERE id = $3',
      [stored.imageKey, stored.thumbKey, album.id],
    )
    await deleteImages(uploadDir, [album.coverImageKey, album.coverThumbKey])
    res.json({ album: await reload(album.id) })
  })

  router.delete('/:id/cover', async (req, res) => {
    const album = await ownedAlbum(req)
    if (!album) return res.status(404).json({ error: 'Album not found' })
    await pool.query(
      'UPDATE albums SET cover_image_key = NULL, cover_thumb_key = NULL, updated_at = now() WHERE id = $1',
      [album.id],
    )
    await deleteImages(uploadDir, [album.coverImageKey, album.coverThumbKey])
    res.json({ album: await reload(album.id) })
  })

  // URLs carry ?v=<key>, so a replaced cover gets a new URL and these can cache forever.
  for (const [suffix, field] of [['image', 'coverImageKey'], ['thumb', 'coverThumbKey']] as const) {
    router.get(`/:id/cover/${suffix}`, async (req, res) => {
      const key = (await ownedAlbum(req))?.[field]
      if (!key) return res.status(404).json({ error: 'No cover photo' })
      res.sendFile(path.join(uploadDir, path.basename(key)), {
        headers: { 'Cache-Control': 'private, max-age=31536000, immutable' },
      })
    })
  }

  /** The shareable story PDF. ?cover=1 adds a cover page. Private notes are never included. */
  router.get('/:id/story.pdf', async (req, res) => {
    const album = await ownedAlbum(req)
    if (!album) return res.status(404).json({ error: 'Album not found' })
    const { rows: items } = await pool.query<{ imageKey: string | null; title: string; publicNotes: string }>(
      `SELECT image_key AS "imageKey", title, public_notes AS "publicNotes"
         FROM items WHERE album_id = $1 ORDER BY sequence, id`,
      [album.id],
    )
    const fileName = storyFileName(album.name)
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${fileName.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(fileName)}`)
    res.setHeader('Cache-Control', 'private, no-store')
    await renderStory(res, {
      uploadDir,
      album: { name: album.name, intro: album.intro, coverImageKey: album.coverImageKey },
      items,
      coverPage: req.query.cover === '1',
    })
  })

  return router
}
