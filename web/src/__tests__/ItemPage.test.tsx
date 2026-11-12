import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Item } from '../api/types'
import ItemPage from '../pages/ItemPage'

const item: Item = {
  id: 7, albumId: 3, imageKey: 'k.jpg', thumbKey: 'k_thumb.jpg', sequence: 4, title: 'Blue vase',
  publicNotes: 'pub', privateNotes: '', createdAt: '', updatedAt: '',
}

const mocks = vi.hoisted(() => ({ getAlbum: vi.fn(), getItem: vi.fn(), createItem: vi.fn(), updateItem: vi.fn(), deleteItem: vi.fn() }))
vi.mock('../api/client', () => ({ api: mocks, imageUrl: () => '/img.jpg' }))
vi.mock('../lib/prepareImage', () => ({ prepareImage: async (f: File) => f }))
vi.mock('../context/AuthContext', () => {
  const value = { user: { id: 1, username: 'alice', isAdmin: false, createdAt: '' } }
  return { useAuth: () => value }
})

function renderAt(path: string) {
  URL.createObjectURL = () => 'blob:preview'
  URL.revokeObjectURL = () => {}
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/albums/:albumId/items/new" element={<ItemPage />} />
        <Route path="/albums/:albumId/items/:itemId" element={<ItemPage />} />
        <Route path="/albums/:albumId" element={<p>Album grid</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => vi.clearAllMocks())

it('shows the next sequence as the default for a new item and sends a typed one', async () => {
  const user = userEvent.setup()
  mocks.getAlbum.mockResolvedValue({ id: 3, nextSequence: 5 })
  mocks.createItem.mockResolvedValue({ ...item, sequence: 2 })
  renderAt('/albums/3/items/new')

  const field = screen.getByLabelText('Sequence')
  expect(await screen.findByPlaceholderText('5 (auto)')).toBe(field)

  const file = new File(['x'], 'photo.heic', { type: 'image/heic' })
  await user.upload(document.querySelector('input[type=file]') as HTMLInputElement, file)
  await user.type(field, '2')
  await user.click(screen.getByRole('button', { name: 'Add to album' }))

  expect(mocks.createItem).toHaveBeenCalledWith(3, expect.objectContaining({ sequence: '2' }), expect.any(Function))
  expect(await screen.findByText('Album grid')).toBeInTheDocument()
})

it('leaves sequence blank on create so the server assigns it', async () => {
  const user = userEvent.setup()
  mocks.getAlbum.mockResolvedValue({ id: 3, nextSequence: 5 })
  mocks.createItem.mockResolvedValue(item)
  renderAt('/albums/3/items/new')
  await user.upload(document.querySelector('input[type=file]') as HTMLInputElement, new File(['x'], 'a.jpg', { type: 'image/jpeg' }))
  await user.click(screen.getByRole('button', { name: 'Add to album' }))
  expect(mocks.createItem).toHaveBeenCalledWith(3, expect.objectContaining({ sequence: undefined }), expect.any(Function))
})

it('opens an existing item read-only until Edit is pressed', async () => {
  mocks.getItem.mockResolvedValue({ ...item, privateNotes: 'line one\nline two' })
  renderAt('/albums/3/items/7')

  expect(await screen.findByRole('button', { name: 'Edit' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Blue vase', level: 2 })).toBeInTheDocument()
  expect(screen.getByText('pub')).toBeInTheDocument()
  expect(screen.getByText(/line one\s+line two/)).toBeInTheDocument()
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  expect(document.querySelector('input[type=file]')).toBeNull()
  expect(screen.queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
})

it('Cancel discards edits and returns to the read-only view', async () => {
  const user = userEvent.setup()
  mocks.getItem.mockResolvedValue(item)
  renderAt('/albums/3/items/7')

  await user.click(await screen.findByRole('button', { name: 'Edit' }))
  const notes = screen.getByLabelText('Public notes')
  await user.clear(notes)
  await user.type(notes, 'changed')
  await user.click(screen.getByRole('button', { name: 'Cancel' }))

  expect(screen.getByText('pub')).toBeInTheDocument()
  expect(screen.queryByText('changed')).not.toBeInTheDocument()
  expect(mocks.updateItem).not.toHaveBeenCalled()

  // Re-entering edit mode starts from the saved values again.
  await user.click(screen.getByRole('button', { name: 'Edit' }))
  expect(screen.getByLabelText('Public notes')).toHaveValue('pub')
})

it('edits an existing sequence; clearing the field keeps the current one', async () => {
  const user = userEvent.setup()
  mocks.getItem.mockResolvedValue(item)
  mocks.updateItem.mockResolvedValue({ ...item, sequence: 9 })
  renderAt('/albums/3/items/7')

  await user.click(await screen.findByRole('button', { name: 'Edit' }))
  const field = screen.getByLabelText('Sequence')
  expect(field).toHaveValue('4')
  await user.clear(field)
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()

  await user.type(field, '9x')
  expect(field).toHaveValue('9')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(mocks.updateItem).toHaveBeenCalledWith(7, expect.objectContaining({ sequence: '9' }), expect.any(Function))

  // Saving returns to the read-only view showing the saved values.
  expect(await screen.findByRole('button', { name: 'Edit' })).toBeInTheDocument()
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  expect(screen.getByText('9')).toBeInTheDocument()
})

it('sends a trimmed title on create', async () => {
  const user = userEvent.setup()
  mocks.getAlbum.mockResolvedValue({ id: 3, nextSequence: 1 })
  mocks.createItem.mockResolvedValue(item)
  renderAt('/albums/3/items/new')
  await user.upload(document.querySelector('input[type=file]') as HTMLInputElement, new File(['x'], 'a.jpg', { type: 'image/jpeg' }))
  await user.type(screen.getByLabelText(/Title/), '  Teapot ')
  await user.click(screen.getByRole('button', { name: 'Add to album' }))
  expect(mocks.createItem).toHaveBeenCalledWith(3, expect.objectContaining({ title: 'Teapot' }), expect.any(Function))
})

it('clears an existing title and falls back to "Item" in the header', async () => {
  const user = userEvent.setup()
  mocks.getItem.mockResolvedValue(item)
  mocks.updateItem.mockResolvedValue({ ...item, title: '' })
  renderAt('/albums/3/items/7')
  expect(await screen.findByRole('heading', { name: 'Blue vase', level: 1 })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Edit' }))
  await user.clear(screen.getByLabelText(/Title/))
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(mocks.updateItem).toHaveBeenCalledWith(7, expect.objectContaining({ title: '' }), expect.any(Function))
  expect(await screen.findByRole('heading', { name: 'Item', level: 1 })).toBeInTheDocument()
})
