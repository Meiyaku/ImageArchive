const MAX_EDGE = 2560
const QUALITY = 0.88

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('decode failed'))
    }
    img.src = url
  })
}

/**
 * Downscales a picked photo to a JPEG before upload.
 *
 * iPhones hand over HEIC files of 3–8 MB. Safari can decode HEIC, but the server's
 * image library can't, so re-encoding here makes iOS uploads work and keeps them small
 * on mobile data. Browsers apply EXIF orientation when drawing, so the output is
 * upright. If the browser can't decode the file we send the original and let the
 * server try.
 */
export async function prepareImage(file: File): Promise<Blob> {
  let img: HTMLImageElement
  try {
    img = await loadImage(file)
  } catch {
    return file
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight))
  const width = Math.round(img.naturalWidth * scale)
  const height = Math.round(img.naturalHeight * scale)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return file
  ctx.drawImage(img, 0, 0, width, height)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY))
  // Free the canvas backing store promptly; iOS caps total canvas memory.
  canvas.width = canvas.height = 0
  return blob ?? file
}
