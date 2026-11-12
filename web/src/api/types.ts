export interface User {
  id: number
  username: string
  isAdmin: boolean
  createdAt: string
}

export interface Album {
  id: number
  name: string
  /** Opening paragraph for the story PDF. */
  intro: string
  itemCount: number
  /** The album's own cover photo; null when none is set. */
  coverImageKey: string | null
  coverThumbKey: string | null
  /** First item by sequence; the list thumbnail falls back to it when there's no cover. */
  firstItemId: number | null
  firstItemThumbKey: string | null
  /** What a new item gets if no sequence is given. */
  nextSequence: number
  createdAt: string
  updatedAt: string
}

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
