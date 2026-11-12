import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import LoginPage from '../pages/LoginPage'

const auth = vi.hoisted(() => ({ user: null, loading: false, login: vi.fn(), logout: vi.fn() }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => auth }))

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<p>Albums home</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

it('signs in and goes to the albums page', async () => {
  const user = userEvent.setup()
  auth.login.mockResolvedValue(undefined)
  renderLogin()
  await user.type(screen.getByLabelText('Username'), 'alice')
  await user.type(screen.getByLabelText('Password'), 'secret-pass')
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
  expect(auth.login).toHaveBeenCalledWith('alice', 'secret-pass')
  expect(await screen.findByText('Albums home')).toBeInTheDocument()
})

it('shows the server error on failure', async () => {
  const user = userEvent.setup()
  auth.login.mockRejectedValue(new Error('Incorrect username or password'))
  renderLogin()
  await user.type(screen.getByLabelText('Username'), 'alice')
  await user.type(screen.getByLabelText('Password'), 'wrong')
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect username or password')
})
