import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { Spinner } from './components/Spinner'
import LoginPage from './pages/LoginPage'
import AlbumsPage from './pages/AlbumsPage'
import AlbumPage from './pages/AlbumPage'
import ItemPage from './pages/ItemPage'
import AdminPage from './pages/AdminPage'
import AccountPage from './pages/AccountPage'

function RequireAuth({ admin = false }: { admin?: boolean }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <Spinner fullScreen />
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (admin && !user.isAdmin) return <Navigate to="/" replace />
  return <Outlet />
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<RequireAuth />}>
            <Route path="/" element={<AlbumsPage />} />
            <Route path="/albums/:albumId" element={<AlbumPage />} />
            <Route path="/albums/:albumId/items/new" element={<ItemPage />} />
            <Route path="/albums/:albumId/items/:itemId" element={<ItemPage />} />
            <Route path="/account" element={<AccountPage />} />
          </Route>
          <Route element={<RequireAuth admin />}>
            <Route path="/admin" element={<AdminPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
