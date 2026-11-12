import type { Request } from 'express'
import multer from 'multer'
import { storeImage, UnsupportedImageError, type StoredImage } from './storage.ts'

export const MAX_UPLOAD_BYTES = 30 * 1024 * 1024

/** Single `image` file field held in memory; sharp re-encodes it before anything touches disk. */
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
})

/** Stores req.file if present. Undecodable bytes become a 400. */
export async function storeUpload(req: Request, uploadDir: string): Promise<StoredImage | null> {
  if (!req.file) return null
  return storeImageOr400(uploadDir, req.file.buffer)
}

export async function storeImageOr400(uploadDir: string, data: Buffer): Promise<StoredImage> {
  try {
    return await storeImage(uploadDir, data)
  } catch (err) {
    const message = err instanceof UnsupportedImageError ? err.message : "That file couldn't be read as an image"
    throw Object.assign(new Error(message), { status: 400 })
  }
}
