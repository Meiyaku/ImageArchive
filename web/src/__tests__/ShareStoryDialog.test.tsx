import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Album, Item } from '../api/types'
import { ShareStoryDialog } from '../components/ShareStoryDialog'

const mocks = vi.hoisted(() => ({ storyPdf: vi.fn(), listItems: vi.fn() }))
vi.mock('../api/client', () => ({ api: mocks, thumbUrl: (id: number) => `/thumb/${id}` }))

const album = (coverImageKey: string | null): Album => ({
  id: 4, name: 'Kitchen', intro: '', itemCount: 2, coverImageKey, coverThumbKey: coverImageKey,
  firstItemId: null, firstItemThumbKey: null, nextSequence: 3, createdAt: '', updatedAt: '',
})
const item = (id: number, sequence: number, title = ''): Item => ({
  id, albumId: 4, imageKey: `${id}.jpg`, thumbKey: `${id}_thumb.jpg`, sequence, title,
  publicNotes: '', privateNotes: '', createdAt: '', updatedAt: '',
})
const pdf = new File(['%PDF-'], 'Kitchen.pdf', { type: 'application/pdf' })

afterEach(() => {
  // @ts-expect-error test cleanup of stubs
  delete navigator.canShare
  // @ts-expect-error test cleanup of stubs
  delete navigator.share
})

it('defaults the cover page on when the album has a cover photo, off otherwise', () => {
  const { unmount } = render(<ShareStoryDialog album={album('c.jpg')} onClose={() => {}} />)
  expect(screen.getByRole('switch', { name: /Include cover page/ })).toBeChecked()
  unmount()
  render(<ShareStoryDialog album={album(null)} onClose={() => {}} />)
  expect(screen.getByRole('switch', { name: /Include cover page/ })).not.toBeChecked()
  expect(screen.getByText(/Private notes are never included/)).toBeInTheDocument()
})

it('creates the PDF, then shares it via the share sheet', async () => {
  const user = userEvent.setup()
  const share = vi.fn().mockResolvedValue(undefined)
  Object.assign(navigator, { canShare: () => true, share })
  mocks.storyPdf.mockResolvedValue(pdf)
  render(<ShareStoryDialog album={album('c.jpg')} onClose={() => {}} />)

  await user.click(screen.getByRole('switch', { name: /Include cover page/ }))
  await user.click(screen.getByRole('button', { name: 'Create PDF' }))
  expect(mocks.storyPdf).toHaveBeenCalledWith(expect.objectContaining({ id: 4 }), { coverPage: false, itemIds: undefined })

  await user.click(await screen.findByRole('button', { name: 'Share' }))
  expect(share).toHaveBeenCalledWith({ files: [pdf], title: 'Kitchen' })
})

it('ignores the user dismissing the share sheet', async () => {
  const user = userEvent.setup()
  Object.assign(navigator, {
    canShare: () => true,
    share: vi.fn().mockRejectedValue(Object.assign(new Error('cancelled'), { name: 'AbortError' })),
  })
  mocks.storyPdf.mockResolvedValue(pdf)
  render(<ShareStoryDialog album={album(null)} onClose={() => {}} />)
  await user.click(screen.getByRole('button', { name: 'Create PDF' }))
  await user.click(await screen.findByRole('button', { name: 'Share' }))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('falls back to a download where file sharing is unavailable', async () => {
  const user = userEvent.setup()
  mocks.storyPdf.mockResolvedValue(pdf)
  URL.createObjectURL = vi.fn(() => 'blob:pdf')
  URL.revokeObjectURL = vi.fn()
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  render(<ShareStoryDialog album={album(null)} onClose={() => {}} />)
  await user.click(screen.getByRole('button', { name: 'Create PDF' }))
  await user.click(await screen.findByRole('button', { name: 'Download PDF' }))
  expect(click).toHaveBeenCalled()
  expect(click.mock.contexts[0]).toMatchObject({ download: 'Kitchen.pdf', href: 'blob:pdf' })
})

it('shows server errors and lets you retry', async () => {
  const user = userEvent.setup()
  mocks.storyPdf.mockRejectedValue(new Error('Album not found'))
  render(<ShareStoryDialog album={album(null)} onClose={() => {}} />)
  await user.click(screen.getByRole('button', { name: 'Create PDF' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Album not found')
  expect(screen.getByRole('button', { name: 'Create PDF' })).toBeEnabled()
})

it('makes a PDF of only the chosen photos', async () => {
  const user = userEvent.setup()
  mocks.listItems.mockResolvedValue([item(10, 1, 'Teapot'), item(11, 2), item(12, 3, 'Kettle')])
  mocks.storyPdf.mockResolvedValue(pdf)
  render(<ShareStoryDialog album={album(null)} onClose={() => {}} />)

  expect(screen.getByRole('radio', { name: 'All photos' })).toBeChecked()
  await user.click(screen.getByRole('radio', { name: 'Choose photos' }))
  expect(await screen.findByText('0 of 3 chosen')).toBeInTheDocument()
  // Nothing chosen yet, so there's nothing to make.
  expect(screen.getByRole('button', { name: 'Create PDF' })).toBeDisabled()

  // Chosen out of order; sent in album order.
  await user.click(screen.getByRole('button', { name: 'Kettle' }))
  await user.click(screen.getByRole('button', { name: 'Teapot' }))
  expect(screen.getByRole('button', { name: 'Kettle' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name: '#2' })).toHaveAttribute('aria-pressed', 'false')
  expect(screen.getByText('2 of 3 chosen')).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Create PDF' }))
  expect(mocks.storyPdf).toHaveBeenCalledWith(expect.objectContaining({ id: 4 }), { coverPage: false, itemIds: [10, 12] })
})

it('select all and clear, and changing the choice means making the PDF again', async () => {
  const user = userEvent.setup()
  mocks.listItems.mockResolvedValue([item(10, 1), item(11, 2)])
  mocks.storyPdf.mockResolvedValue(pdf)
  render(<ShareStoryDialog album={album(null)} onClose={() => {}} />)

  await user.click(screen.getByRole('radio', { name: 'Choose photos' }))
  await user.click(await screen.findByRole('button', { name: 'Select all' }))
  expect(screen.getByText('2 of 2 chosen')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Create PDF' }))
  expect(mocks.storyPdf).toHaveBeenLastCalledWith(expect.anything(), { coverPage: false, itemIds: [10, 11] })
  await screen.findByRole('button', { name: 'Download PDF' })

  await user.click(screen.getByRole('button', { name: '#1' }))
  expect(screen.getByRole('button', { name: 'Create PDF' })).toBeEnabled()

  await user.click(screen.getByRole('button', { name: 'Clear' }))
  expect(screen.getByText('0 of 2 chosen')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Create PDF' })).toBeDisabled()

  // Back to all photos: no list sent.
  await user.click(screen.getByRole('radio', { name: 'All photos' }))
  await user.click(screen.getByRole('button', { name: 'Create PDF' }))
  expect(mocks.storyPdf).toHaveBeenLastCalledWith(expect.anything(), { coverPage: false, itemIds: undefined })
  expect(mocks.listItems).toHaveBeenCalledTimes(1)
})
