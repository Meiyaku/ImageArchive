import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Album } from '../api/types'
import { ShareStoryDialog } from '../components/ShareStoryDialog'

const mocks = vi.hoisted(() => ({ storyPdf: vi.fn() }))
vi.mock('../api/client', () => ({ api: mocks }))

const album = (coverImageKey: string | null): Album => ({
  id: 4, name: 'Kitchen', intro: '', itemCount: 2, coverImageKey, coverThumbKey: coverImageKey,
  firstItemId: null, firstItemThumbKey: null, nextSequence: 3, createdAt: '', updatedAt: '',
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
  expect(mocks.storyPdf).toHaveBeenCalledWith(expect.objectContaining({ id: 4 }), false)

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
