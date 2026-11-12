import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import type { Writable } from 'node:stream'
import * as fontkit from 'fontkit'
import PDFDocument from 'pdfkit'
import sharp from 'sharp'

/**
 * Renders an album as a shareable "story" PDF on US Letter: an optional cover page
 * (name, cover photo, intro), then every item in sequence order as one continuous
 * flow — photo, title, public notes. Private notes are never passed in.
 *
 * Layout rules: a photo is never split and its title stays with it (both move to the
 * next page if they won't fit); notes flow across pages; story pages are numbered.
 */

export interface StoryAlbum {
  name: string
  intro: string
  coverImageKey: string | null
}

export interface StoryItem {
  imageKey: string | null
  title: string
  publicNotes: string
}

export interface StoryOptions {
  uploadDir: string
  album: StoryAlbum
  items: StoryItem[]
  coverPage: boolean
}

const PAGE_W = 612
const PAGE_H = 792
const MARGIN = 54
const CONTENT_W = PAGE_W - MARGIN * 2
/** Photos are capped so two items can share a page — this is a flowing story, not a photo book. */
const MAX_PHOTO_H = (PAGE_H - MARGIN * 2) * 0.42
/** Photos are re-encoded at this size: sharp on screen, small enough to send by message. */
const PDF_PHOTO_PX = 1600

const INK = '#1f2328'
const MUTED = '#6b7280'
const RULE = '#d1d5db'

const require = createRequire(import.meta.url)
const FONT_DIR = path.join(path.dirname(require.resolve('dejavu-fonts-ttf/package.json')), 'ttf')
const FONTS = {
  body: 'DejaVuSerif.ttf',
  italic: 'DejaVuSerif-Italic.ttf',
  heading: 'DejaVuSans-Bold.ttf',
  small: 'DejaVuSans.ttf',
} as const
type FontName = keyof typeof FONTS

// Loaded once; used to drop characters a font can't draw (mostly emoji) instead of
// printing empty boxes.
const glyphs = new Map<FontName, fontkit.Font>()
function fontFor(name: FontName): fontkit.Font {
  let font = glyphs.get(name)
  if (!font) {
    font = fontkit.openSync(path.join(FONT_DIR, FONTS[name])) as fontkit.Font
    glyphs.set(name, font)
  }
  return font
}

export function cleanText(text: string, font: FontName): string {
  const f = fontFor(font)
  return Array.from(text.replace(/\r\n?/g, '\n'))
    .filter((ch) => ch === '\n' || ch === '\t' || f.hasGlyphForCodePoint(ch.codePointAt(0)!))
    .join('')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

export function storyFileName(albumName: string): string {
  // Control characters are exactly what we want to strip from a file name.
  // eslint-disable-next-line no-control-regex
  const safe = albumName.replace(/[\\/:*?"<>|\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim()
  return `${safe || 'Album'}.pdf`
}

interface Photo {
  data: Buffer
  width: number
  height: number
}

async function loadPhoto(uploadDir: string, key: string | null): Promise<Photo | null> {
  if (!key) return null
  try {
    const source = await readFile(path.join(uploadDir, path.basename(key)))
    const { data, info } = await sharp(source)
      .resize({ width: PDF_PHOTO_PX, height: PDF_PHOTO_PX, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80, mozjpeg: true })
      .toBuffer({ resolveWithObject: true })
    return { data, width: info.width, height: info.height }
  } catch {
    // A missing or unreadable file shouldn't sink the whole export.
    return null
  }
}

function fit(photo: Photo, maxW: number, maxH: number): { width: number; height: number } {
  const scale = Math.min(maxW / photo.width, maxH / photo.height, 1.5)
  return { width: photo.width * scale, height: photo.height * scale }
}

export async function renderStory(out: Writable, { uploadDir, album, items, coverPage }: StoryOptions): Promise<void> {
  const doc = new PDFDocument({
    size: 'LETTER',
    margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    autoFirstPage: false,
    info: { Title: album.name, Creator: 'Image Archive' },
  })
  for (const [name, file] of Object.entries(FONTS)) doc.registerFont(name, path.join(FONT_DIR, file))

  const finished = new Promise<void>((resolve, reject) => {
    out.on('finish', resolve)
    out.on('close', resolve)
    out.on('error', reject)
    doc.on('error', reject)
  })
  doc.pipe(out)

  // pdfkit has no "current style" getter, so track it to restore after footers.
  let style: [FontName, number, string] = ['body', 12, INK]
  const setStyle = (font: FontName, size: number, color = INK) => {
    style = [font, size, color]
    doc.font(font).fontSize(size).fillColor(color)
  }

  // Page numbers on story pages. pageAdded also fires when notes overflow mid-paragraph,
  // so the footer must leave position and style exactly as it found them.
  let pageNumber = 0
  let numbering = false
  doc.on('pageAdded', () => {
    if (!numbering) return
    pageNumber++
    const { x, y } = doc
    const saved = style
    const bottom = doc.page.margins.bottom
    doc.page.margins.bottom = 0
    setStyle('small', 9, MUTED)
    doc.text(String(pageNumber), 0, PAGE_H - MARGIN / 2 - 6, { width: PAGE_W, align: 'center', lineBreak: false })
    doc.page.margins.bottom = bottom
    setStyle(...saved)
    doc.x = x
    doc.y = y
  })

  const remaining = () => doc.page.maxY() - doc.y
  const atPageTop = () => doc.y <= MARGIN + 1
  const needSpace = (height: number) => {
    if (height > remaining() && !atPageTop()) doc.addPage()
  }

  const name = cleanText(album.name, 'heading')
  const intro = cleanText(album.intro, 'italic')
  let introPending = !!intro

  if (coverPage) {
    doc.addPage()
    setStyle('heading', 30)
    doc.text(name, MARGIN, MARGIN + 40, { width: CONTENT_W, align: 'center' })
    doc.moveDown(1)

    const cover = await loadPhoto(uploadDir, album.coverImageKey)
    if (cover) {
      const size = fit(cover, CONTENT_W, 380)
      doc.image(cover.data, MARGIN + (CONTENT_W - size.width) / 2, doc.y, size)
      doc.y += size.height + 28
    }

    // A long intro that won't fit under the photo opens the story pages instead.
    if (intro) {
      setStyle('italic', 13, MUTED)
      const h = doc.heightOfString(intro, { width: CONTENT_W * 0.85, lineGap: 4 })
      if (h <= remaining()) {
        doc.text(intro, MARGIN + CONTENT_W * 0.075, doc.y, { width: CONTENT_W * 0.85, align: 'center', lineGap: 4 })
        introPending = false
      }
    }
  }

  numbering = true
  doc.addPage()

  if (!coverPage) {
    setStyle('heading', 24)
    doc.text(name, MARGIN, doc.y, { width: CONTENT_W })
    doc.moveDown(0.5)
  }
  if (introPending) {
    setStyle('italic', 12, MUTED)
    doc.text(intro, MARGIN, doc.y, { width: CONTENT_W, lineGap: 4 })
  }
  let first = coverPage && !introPending

  if (items.length === 0) {
    if (!first) doc.moveDown(1)
    setStyle('italic', 12, MUTED)
    doc.text('This album has no items yet.', MARGIN, doc.y, { width: CONTENT_W })
  }

  for (const item of items) {
    // Short centred rule between items (and after the heading/intro).
    if (!first) {
      if (remaining() > 60) {
        doc.y += 20
        const mid = PAGE_W / 2
        doc.moveTo(mid - 30, doc.y).lineTo(mid + 30, doc.y).lineWidth(0.75).strokeColor(RULE).stroke()
        doc.y += 20
      } else {
        doc.addPage()
      }
    }
    first = false

    const photo = await loadPhoto(uploadDir, item.imageKey)
    const title = cleanText(item.title, 'heading')
    const notes = cleanText(item.publicNotes, 'body')
    const size = photo ? fit(photo, CONTENT_W, MAX_PHOTO_H) : null

    setStyle('heading', 15)
    const titleH = title ? doc.heightOfString(title, { width: CONTENT_W }) + 6 : 0
    setStyle('body', 11.5)
    const firstLineH = notes ? doc.currentLineHeight(true) + 3 : 0
    // Photo + title (+ first line of notes) move to the next page together.
    needSpace((size ? size.height + 12 : 0) + titleH + firstLineH)

    if (photo && size) {
      doc.image(photo.data, MARGIN + (CONTENT_W - size.width) / 2, doc.y, size)
      doc.y += size.height + 12
    }
    if (title) {
      setStyle('heading', 15)
      doc.text(title, MARGIN, doc.y, { width: CONTENT_W })
      doc.y += 6
    }
    if (notes) {
      setStyle('body', 11.5)
      doc.text(notes, MARGIN, doc.y, { width: CONTENT_W, lineGap: 3 })
    }
  }

  doc.end()
  await finished
}
