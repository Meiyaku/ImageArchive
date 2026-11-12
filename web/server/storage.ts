import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

export interface StoredImage {
  imageKey: string
  thumbKey: string
}

const THUMB_SIZE = 600

/**
 * Normalises an upload to JPEG (honouring EXIF rotation, which drops the tag),
 * writes it plus a square-ish thumbnail, and returns the file names.
 * Throws if sharp can't decode the bytes.
 */
export async function storeImage(uploadDir: string, data: Buffer): Promise<StoredImage> {
  await mkdir(uploadDir, { recursive: true })
  const id = randomUUID()
  const base = sharp(data, { failOn: 'error' }).rotate()
  const [full, thumb] = await Promise.all([
    base.clone().resize({ width: 3000, height: 3000, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 88, mozjpeg: true }).toBuffer(),
    base.clone().resize({ width: THUMB_SIZE, height: THUMB_SIZE, fit: 'cover' })
      .jpeg({ quality: 80, mozjpeg: true }).toBuffer(),
  ])
  const imageKey = `${id}.jpg`
  const thumbKey = `${id}_thumb.jpg`
  await Promise.all([
    writeFile(path.join(uploadDir, imageKey), full),
    writeFile(path.join(uploadDir, thumbKey), thumb),
  ])
  return { imageKey, thumbKey }
}

export async function deleteImages(uploadDir: string, keys: (string | null)[]): Promise<void> {
  await Promise.all(
    keys.filter((k): k is string => !!k).map((k) => rm(path.join(uploadDir, path.basename(k)), { force: true })),
  )
}
