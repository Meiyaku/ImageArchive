import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { Album } from '../api/types'
import AlbumsPage from '../pages/AlbumsPage'

const album = (id: number, name: string, itemCount = 0): Album => ({
  id, name, intro: '', itemCount, coverImageKey: null, coverThumbKey: null, firstItemId: null, firstItemThumbKey: null,
  nextSequence: itemCount + 1, createdAt: '', updatedAt: '',
})

const mocks = vi.hoisted(() => ({
  listAlbums: vi.fn(),
  updateAlbum: vi.fn(),
  uploadAlbumCover: vi.fn(),
  setAlbumCoverFromItem: vi.fn(),
  removeAlbumCover: vi.fn(),
  listItems: vi.fn(),
  deleteAlbum: vi.fn(),
  createAlbum: vi.fn(),
}))
vi.mock('../api/client', () => ({
  api: mocks,
  thumbUrl: (id: number) => `/thumb/${id}`,
  albumCoverUrl: () => '/cover',
  albumThumbUrl: () => null,
}))
vi.mock('../context/AuthContext', () => {
  const value = { user: { id: 1, username: 'alice', isAdmin: false, createdAt: '' } }
  return { useAuth: () => value }
})

function renderPage() {
  return render(<MemoryRouter><AlbumsPage /></MemoryRouter>)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.listAlbums.mockResolvedValue([album(1, 'Beach', 3), album(2, 'Cats', 1)])
})

it('lists album names with item counts', async () => {
  renderPage()
  expect(await screen.findByText('Beach')).toBeInTheDocument()
  expect(screen.getByText('3 items')).toBeInTheDocument()
  expect(screen.getByText('1 item')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /Beach/ })).toHaveAttribute('href', '/albums/1')
})

it('renames an album and sets its intro from Edit album', async () => {
  const user = userEvent.setup()
  mocks.updateAlbum.mockResolvedValue({ ...album(1, 'Seaside', 3), intro: 'Summer' })
  renderPage()
  await user.click(await screen.findByRole('button', { name: 'Options for Beach' }))
  await user.click(screen.getByRole('menuitem', { name: /Edit album/ }))

  const dialog = screen.getByRole('dialog', { name: 'Edit album' })
  const input = within(dialog).getByLabelText('Name')
  expect(input).toHaveValue('Beach')
  await user.clear(input)
  await user.type(input, 'Seaside')
  await user.type(within(dialog).getByLabelText(/Intro/), 'Summer')
  await user.click(within(dialog).getByRole('button', { name: 'Save' }))

  expect(mocks.updateAlbum).toHaveBeenCalledWith(1, { name: 'Seaside', intro: 'Summer' })
  expect(mocks.uploadAlbumCover).not.toHaveBeenCalled()
  expect(await screen.findByText('Seaside')).toBeInTheDocument()
})

it('chooses a cover from the album only when Save is pressed', async () => {
  const user = userEvent.setup()
  mocks.listItems.mockResolvedValue([
    { id: 11, albumId: 1, imageKey: 'a', thumbKey: 'a_t', sequence: 1, title: 'Shell', publicNotes: '', privateNotes: '', createdAt: '', updatedAt: '' },
  ])
  mocks.setAlbumCoverFromItem.mockResolvedValue({ ...album(1, 'Beach', 3), coverImageKey: 'c', coverThumbKey: 'c_t' })
  renderPage()
  await user.click(await screen.findByRole('button', { name: 'Options for Beach' }))
  await user.click(screen.getByRole('menuitem', { name: /Edit album/ }))
  await user.click(screen.getByRole('button', { name: 'Choose from album' }))
  await user.click(await screen.findByRole('button', { name: 'Use Shell as cover' }))

  // Back on the edit form with a preview; nothing saved yet.
  expect(screen.getByRole('img', { name: 'Cover' })).toHaveAttribute('src', '/thumb/11')
  expect(mocks.setAlbumCoverFromItem).not.toHaveBeenCalled()

  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(mocks.setAlbumCoverFromItem).toHaveBeenCalledWith(1, 11)
  expect(mocks.updateAlbum).not.toHaveBeenCalled()
})

it('deletes an album after confirmation', async () => {
  const user = userEvent.setup()
  mocks.deleteAlbum.mockResolvedValue(undefined)
  renderPage()
  await user.click(await screen.findByRole('button', { name: 'Options for Cats' }))
  await user.click(screen.getByRole('menuitem', { name: /Delete/ }))

  const dialog = screen.getByRole('dialog', { name: 'Delete album?' })
  expect(dialog).toHaveTextContent('"Cats" and its 1 item will be permanently deleted.')
  await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

  expect(mocks.deleteAlbum).toHaveBeenCalledWith(2)
  await waitFor(() => expect(screen.queryByText('Cats')).not.toBeInTheDocument())
})

it('shows an empty state with a create button', async () => {
  mocks.listAlbums.mockResolvedValue([])
  renderPage()
  expect(await screen.findByRole('button', { name: /Create an album/ })).toBeInTheDocument()
})
