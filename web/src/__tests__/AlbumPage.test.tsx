import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Item } from '../api/types'
import AlbumPage from '../pages/AlbumPage'

const item = (id: number, sequence: number, title: string): Item => ({
  id, albumId: 3, imageKey: 'k', thumbKey: 'k', sequence, title,
  publicNotes: `public text ${id}`, privateNotes: '', createdAt: '', updatedAt: '',
})

const mocks = vi.hoisted(() => ({ getAlbum: vi.fn(), listItems: vi.fn() }))
vi.mock('../api/client', () => ({ api: mocks, thumbUrl: () => '/t.jpg' }))
vi.mock('../context/AuthContext', () => {
  const value = { user: { id: 1, username: 'alice', isAdmin: false, createdAt: '' } }
  return { useAuth: () => value }
})

it('captions tiles with the title, or the sequence number when untitled, and hides public notes', async () => {
  mocks.getAlbum.mockResolvedValue({ id: 3, name: 'Kitchen' })
  mocks.listItems.mockResolvedValue([item(1, 1, 'Teapot'), item(2, 2, '')])
  render(
    <MemoryRouter initialEntries={['/albums/3']}>
      <Routes><Route path="/albums/:albumId" element={<AlbumPage />} /></Routes>
    </MemoryRouter>,
  )

  const [titled, untitled] = await screen.findAllByRole('listitem')
  expect(titled).toHaveTextContent(/^Teapot$/)
  expect(untitled).toHaveTextContent(/^#2$/)
  expect(screen.queryByText(/public text/)).not.toBeInTheDocument()
  expect(screen.getByAltText('Item 2')).toBeInTheDocument()
})
