import path from 'node:path'
import { Router, type Request } from 'express'
import type { Pool } from '../db.ts'
import { deleteImages } from '../storage.ts'
import { storeUpload, upload } from '../upload.ts'

export interface Item {
  id: number
  albumId: number
  imageKey: string | null
  thumbKey: string | null
  sequence: number
  title: string
  publicNotes: string
  privateNotes: string
  createdAt: string
  updatedAt: string
}

const ITEM_COLUMNS = `i.id, i.album_id AS "albumId", i.image_key AS "imageKey", i.thumb_key AS "thumbKey",
  i.sequence, i.title, i.public_notes AS "publicNotes", i.private_notes AS "privateNotes",
  i.created_at AS "createdAt", i.updated_at AS "updatedAt"`

const MAX_NOTES = 20_000
export const MAX_TITLE = 200

/** Trimmed and capped; undefined when the field wasn't sent (leave unchanged). */
function title(value: unknown): string | undefined {
  if (value === undefined) return undefined
  return typeof value === 'string' ? value.trim().slice(0, MAX_TITLE) : ''
}

function notes(value: unknown): string | undefined {
  if (value === undefined) return undefined
  return typeof value === 'string' ? value.slice(0, MAX_NOTES) : ''
}

export const MAX_SEQUENCE = 1_000_000_000

/** Blank/missing → undefined (server picks); otherwise a whole number 0…MAX_SEQUENCE. */
export function parseSequence(value: unknown): number | undefined {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) return undefined
  const str = String(value).trim()
  const n = Number(str)
  if (!/^\d+$/.test(str) || n > MAX_SEQUENCE) {
    throw Object.assign(new Error('Sequence must be a whole number (0 or more)'), { status: 400 })
  }
  return n
}

/** Routes mounted at /api; all paths check the album belongs to req.user. */
export function itemRoutes(pool: Pool, uploadDir: string): Router {
  const router = Router()

  const ownedItem = async (req: Request): Promise<Item | undefined> => {
    const { rows } = await pool.query<Item>(
      `SELECT ${ITEM_COLUMNS} FROM items i JOIN albums a ON a.id = i.album_id WHERE i.id = $1 AND a.user_id = $2`,
      [Number(req.params.id), req.user!.id],
    )
    return rows[0]
  }

  const ownsAlbum = async (req: Request): Promise<boolean> => {
    const { rowCount } = await pool.query('SELECT 1 FROM albums WHERE id = $1 AND user_id = $2', [
      Number(req.params.albumId), req.user!.id,
    ])
    return !!rowCount
  }

  router.get('/albums/:albumId/items', async (req, res) => {
    if (!(await ownsAlbum(req))) return res.status(404).json({ error: 'Album not found' })
    const { rows } = await pool.query<Item>(
      `SELECT ${ITEM_COLUMNS} FROM items i WHERE i.album_id = $1 ORDER BY i.sequence, i.id`,
      [Number(req.params.albumId)],
    )
    res.json({ items: rows })
  })

  router.post('/albums/:albumId/items', upload.single('image'), async (req, res) => {
    if (!(await ownsAlbum(req))) return res.status(404).json({ error: 'Album not found' })
    if (!req.file) return res.status(400).json({ error: 'An image is required' })
    const sequence = parseSequence(req.body?.sequence)
    const image = await storeUpload(req, uploadDir)
    const { rows } = await pool.query<{ id: number }>(
      // No sequence given: one past the album's highest, so new items count up from 1.
      `INSERT INTO items (album_id, image_key, thumb_key, public_notes, private_notes, sequence, title)
       VALUES ($1, $2, $3, $4, $5,
               COALESCE($6::int, (SELECT COALESCE(max(sequence), 0) + 1 FROM items WHERE album_id = $1)), $7)
       RETURNING id`,
      [Number(req.params.albumId), image!.imageKey, image!.thumbKey,
        notes(req.body?.publicNotes) ?? '', notes(req.body?.privateNotes) ?? '', sequence ?? null,
        title(req.body?.title) ?? ''],
    )
    await pool.query('UPDATE albums SET updated_at = now() WHERE id = $1', [Number(req.params.albumId)])
    const created = await pool.query<Item>(`SELECT ${ITEM_COLUMNS} FROM items i WHERE i.id = $1`, [rows[0].id])
    res.status(201).json({ item: created.rows[0] })
  })

  router.get('/items/:id', async (req, res) => {
    const item = await ownedItem(req)
    if (!item) return res.status(404).json({ error: 'Item not found' })
    res.json({ item })
  })

  // Multipart so the image can be replaced in the same request as the text fields.
  router.patch('/items/:id', upload.single('image'), async (req, res) => {
    const item = await ownedItem(req)
    if (!item) return res.status(404).json({ error: 'Item not found' })
    const sequence = parseSequence(req.body?.sequence)
    const image = await storeUpload(req, uploadDir)
    const { rows } = await pool.query<Item>(
      `UPDATE items i SET
         public_notes = COALESCE($2, public_notes),
         private_notes = COALESCE($3, private_notes),
         image_key = COALESCE($4, image_key),
         thumb_key = COALESCE($5, thumb_key),
         sequence = COALESCE($6::int, sequence),
         title = COALESCE($7, title),
         updated_at = now()
       WHERE i.id = $1 RETURNING ${ITEM_COLUMNS}`,
      [item.id, notes(req.body?.publicNotes) ?? null, notes(req.body?.privateNotes) ?? null,
        image?.imageKey ?? null, image?.thumbKey ?? null, sequence ?? null, title(req.body?.title) ?? null],
    )
    if (image) await deleteImages(uploadDir, [item.imageKey, item.thumbKey])
    res.json({ item: rows[0] })
  })

  router.delete('/items/:id', async (req, res) => {
    const item = await ownedItem(req)
    if (!item) return res.status(404).json({ error: 'Item not found' })
    await pool.query('DELETE FROM items WHERE id = $1', [item.id])
    await deleteImages(uploadDir, [item.imageKey, item.thumbKey])
    res.status(204).end()
  })

  // Image URLs carry ?v=<key>, so a replaced image gets a new URL and these can cache forever.
  for (const [suffix, field] of [['image', 'imageKey'], ['thumb', 'thumbKey']] as const) {
    router.get(`/items/:id/${suffix}`, async (req, res) => {
      const item = await ownedItem(req)
      const key = item?.[field]
      if (!key) return res.status(404).json({ error: 'Image not found' })
      res.sendFile(path.join(uploadDir, path.basename(key)), {
        headers: { 'Cache-Control': 'private, max-age=31536000, immutable' },
      })
    })
  }

  return router
}
