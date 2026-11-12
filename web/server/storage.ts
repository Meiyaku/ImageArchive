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
 * Bigger than any phone or consumer camera (iPhones are 12–48 MP), small enough that a
 * tiny, highly compressed "decompression bomb" can't exhaust the container's memory.
 */
export const MAX_INPUT_PIXELS = 100_000_000

/** Photo formats only — no SVG, PDF or other formats sharp could otherwise parse. HEIC/AVIF report as heif. */
const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif', 'tiff', 'heif'])

/** A decodable upload we refuse; the message is shown to the user. */
export class UnsupportedImageError extends Error {}

/**
 * Normalises an upload to JPEG (honouring EXIF rotation, which drops the tag),
 * writes it plus a square-ish thumbnail, and returns the file names.
 * Throws if sharp can't decode the bytes, the format isn't a photo format, or the
 * image is over MAX_INPUT_PIXELS.
 */
export async function storeImage(uploadDir: string, data: Buffer): Promise<StoredImage> {
  const options = { failOn: 'error', limitInputPixels: MAX_INPUT_PIXELS } as const
  const tooLarge = () => new UnsupportedImageError('That image is too large (max 100 megapixels)')
  // Reads only the header, so the format and size checks happen before any decoding.
  // sharp itself enforces limitInputPixels at this point.
  const meta = await sharp(data, options).metadata().catch((err: Error) => {
    throw /pixel limit/i.test(err.message) ? tooLarge() : err
  })
  if (!meta.format || !ALLOWED_FORMATS.has(meta.format)) {
    throw new UnsupportedImageError('Please choose a photo (JPEG, PNG, HEIC, WebP, GIF or TIFF)')
  }
  if ((meta.width ?? 0) * (meta.height ?? 0) > MAX_INPUT_PIXELS) throw tooLarge()

  await mkdir(uploadDir, { recursive: true })
  const id = randomUUID()
  const base = sharp(data, options).rotate()
  // One after the other: each pipeline decodes the full image, so running them in
  // parallel would double peak memory.
  const full = await base.clone().resize({ width: 3000, height: 3000, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 88, mozjpeg: true }).toBuffer()
  const thumb = await base.clone().resize({ width: THUMB_SIZE, height: THUMB_SIZE, fit: 'cover' })
    .jpeg({ quality: 80, mozjpeg: true }).toBuffer()
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
