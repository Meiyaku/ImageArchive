import type { Album, Item, LoginAttempt, User } from './types'

export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function parseError(status: number, text: string): Promise<ApiError> {
  try {
    return new ApiError(status, JSON.parse(text).error ?? `Request failed (${status})`)
  } catch {
    return new ApiError(status, status === 413 ? 'That image is too large' : `Request failed (${status})`)
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${url}`, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) throw await parseError(res.status, await res.text())
  return (res.status === 204 ? undefined : await res.json()) as T
}

/** Multipart upload via XHR, since fetch can't report upload progress. */
function upload<T>(method: string, url: string, form: FormData, onProgress?: (fraction: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open(method, `/api${url}`)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total)
    }
    xhr.onload = async () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText))
      else reject(await parseError(xhr.status, xhr.responseText))
    }
    xhr.onerror = () => reject(new ApiError(0, 'Network error — check your connection and try again'))
    xhr.send(form)
  })
}

export interface ItemFields {
  image?: Blob | null
  /** Blank on create = next number in the album. */
  sequence?: string
  title?: string
  publicNotes?: string
  privateNotes?: string
}

function itemForm({ image, sequence, title, publicNotes, privateNotes }: ItemFields): FormData {
  const form = new FormData()
  if (sequence !== undefined) form.append('sequence', sequence)
  // Text fields first so multer has them when it reaches the file.
  if (title !== undefined) form.append('title', title)
  if (publicNotes !== undefined) form.append('publicNotes', publicNotes)
  if (privateNotes !== undefined) form.append('privateNotes', privateNotes)
  if (image) form.append('image', image, 'image.jpg')
  return form
}

export const api = {
  me: () => request<{ user: User }>('GET', '/auth/me').then((r) => r.user),
  login: (username: string, password: string) =>
    request<{ user: User }>('POST', '/auth/login', { username, password }).then((r) => r.user),
  logout: () => request<void>('POST', '/auth/logout'),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<void>('POST', '/auth/password', { currentPassword, newPassword }),

  listAlbums: () => request<{ albums: Album[] }>('GET', '/albums').then((r) => r.albums),
  getAlbum: (id: number) => request<{ album: Album }>('GET', `/albums/${id}`).then((r) => r.album),
  createAlbum: (name: string) => request<{ album: Album }>('POST', '/albums', { name }).then((r) => r.album),
  updateAlbum: (id: number, changes: { name?: string; intro?: string }) =>
    request<{ album: Album }>('PATCH', `/albums/${id}`, changes).then((r) => r.album),
  uploadAlbumCover: (id: number, image: Blob, onProgress?: (f: number) => void) => {
    const form = new FormData()
    form.append('image', image, 'cover.jpg')
    return upload<{ album: Album }>('PUT', `/albums/${id}/cover`, form, onProgress).then((r) => r.album)
  },
  /** Copies an item's photo in this album to be the cover. */
  setAlbumCoverFromItem: (id: number, itemId: number) =>
    request<{ album: Album }>('PUT', `/albums/${id}/cover`, { fromItemId: itemId }).then((r) => r.album),
  removeAlbumCover: (id: number) => request<{ album: Album }>('DELETE', `/albums/${id}/cover`).then((r) => r.album),
  /** The shareable story PDF as a File, ready for navigator.share or download. */
  storyPdf: async (album: Album, coverPage: boolean): Promise<File> => {
    const res = await fetch(`/api/albums/${album.id}/story.pdf${coverPage ? '?cover=1' : ''}`, { credentials: 'same-origin' })
    if (!res.ok) throw await parseError(res.status, await res.text())
    return new File([await res.blob()], storyFileName(album.name), { type: 'application/pdf' })
  },
  deleteAlbum: (id: number) => request<void>('DELETE', `/albums/${id}`),

  listItems: (albumId: number) => request<{ items: Item[] }>('GET', `/albums/${albumId}/items`).then((r) => r.items),
  getItem: (id: number) => request<{ item: Item }>('GET', `/items/${id}`).then((r) => r.item),
  createItem: (albumId: number, fields: ItemFields, onProgress?: (f: number) => void) =>
    upload<{ item: Item }>('POST', `/albums/${albumId}/items`, itemForm(fields), onProgress).then((r) => r.item),
  updateItem: (id: number, fields: ItemFields, onProgress?: (f: number) => void) =>
    upload<{ item: Item }>('PATCH', `/items/${id}`, itemForm(fields), onProgress).then((r) => r.item),
  deleteItem: (id: number) => request<void>('DELETE', `/items/${id}`),

  listUsers: () => request<{ users: User[] }>('GET', '/admin/users').then((r) => r.users),
  createUser: (username: string, password: string, isAdmin: boolean) =>
    request<{ user: User }>('POST', '/admin/users', { username, password, isAdmin }).then((r) => r.user),
  updateUser: (id: number, changes: { password?: string; isAdmin?: boolean }) =>
    request<{ user: User }>('PATCH', `/admin/users/${id}`, changes).then((r) => r.user),
  deleteUser: (id: number) => request<void>('DELETE', `/admin/users/${id}`),
  listLogins: () => request<{ attempts: LoginAttempt[] }>('GET', '/admin/logins').then((r) => r.attempts),
}

/** Mirrors the server's storyFileName so the shared file has a sensible name. */
export function storyFileName(albumName: string): string {
  // Control characters are exactly what we want to strip from a file name.
  // eslint-disable-next-line no-control-regex
  const safe = albumName.replace(/[\\/:*?"<>|\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim()
  return `${safe || 'Album'}.pdf`
}

export const albumCoverUrl = (album: Album) => `/api/albums/${album.id}/cover/thumb?v=${album.coverThumbKey ?? ''}`

/** List thumbnail: the album's cover photo, else its first item, else null. */
export function albumThumbUrl(album: Album): string | null {
  if (album.coverThumbKey) return albumCoverUrl(album)
  if (album.firstItemId) return thumbUrl(album.firstItemId, album.firstItemThumbKey)
  return null
}

export const thumbUrl = (itemId: number, key: string | null) => `/api/items/${itemId}/thumb?v=${key ?? ''}`
export const imageUrl = (itemId: number, key: string | null) => `/api/items/${itemId}/image?v=${key ?? ''}`
