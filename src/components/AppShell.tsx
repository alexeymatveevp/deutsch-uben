import { useEffect } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import Header from './Header'

export default function AppShell() {
  const navigate = useNavigate()

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const handler = (event: MessageEvent) => {
      const data = event.data as { type?: string; path?: string } | undefined
      if (data?.type !== 'sw-navigate') return
      // SW sends a relative path (e.g. "learning" or ""); react-router's
      // navigate() uses paths rooted at the BrowserRouter basename, so
      // we prepend "/" to the relative fragment.
      const path = (data.path ?? '').replace(/^\/+/, '')
      navigate(`/${path}`, { replace: false })
    }
    navigator.serviceWorker.addEventListener('message', handler)
    return () => navigator.serviceWorker.removeEventListener('message', handler)
  }, [navigate])

  return (
    <>
      <Header />
      <Outlet />
    </>
  )
}
