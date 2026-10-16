import { useEffect, useRef, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { PAGES } from '../nav'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Touches starting within this many px of the left edge can drag the drawer out. */
const EDGE_PX = 28
/** How far (fraction of drawer width) a drag must travel to toggle on release. */
const COMMIT_FRACTION = 0.35
/** Minimum horizontal movement before a touch counts as a horizontal drag. */
const DRAG_SLOP = 8

/**
 * Left-hand navigation panel. Opens from the ☰ button in the header, from a
 * finger swipe that starts at the left screen edge, and closes on a swipe
 * left, a tap on the backdrop, Escape, or navigation.
 *
 * While a finger is down the panel follows it; on release it snaps open or
 * shut depending on how far it travelled.
 */
export default function Drawer({ open, onOpenChange }: Props) {
  const location = useLocation()
  const panelRef = useRef<HTMLElement>(null)
  // Pixels the panel is currently dragged to, from -width (shut) to 0 (open).
  const [dragX, setDragX] = useState<number | null>(null)
  const touch = useRef<{ x: number; y: number; horizontal: boolean | null; opening: boolean } | null>(null)
  const openRef = useRef(open)
  openRef.current = open

  // Close whenever the route changes (the user picked a destination).
  useEffect(() => {
    onOpenChange(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onOpenChange])

  useEffect(() => {
    const width = () => panelRef.current?.offsetWidth ?? 280

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      const t = e.touches[0]
      const isOpen = openRef.current
      if (!isOpen && t.clientX > EDGE_PX) return
      touch.current = { x: t.clientX, y: t.clientY, horizontal: null, opening: !isOpen }
    }

    const onMove = (e: TouchEvent) => {
      const s = touch.current
      if (!s) return
      const t = e.touches[0]
      const dx = t.clientX - s.x
      const dy = t.clientY - s.y
      if (s.horizontal === null) {
        if (Math.abs(dx) < DRAG_SLOP && Math.abs(dy) < DRAG_SLOP) return
        s.horizontal = Math.abs(dx) > Math.abs(dy)
        if (!s.horizontal) {
          touch.current = null
          return
        }
      }
      const w = width()
      const base = s.opening ? -w : 0
      setDragX(Math.max(-w, Math.min(0, base + dx)))
      // Stop the page from scrolling sideways / the browser from navigating.
      if (e.cancelable) e.preventDefault()
    }

    const onEnd = () => {
      const s = touch.current
      touch.current = null
      if (!s || s.horizontal !== true) {
        setDragX(null)
        return
      }
      setDragX((x) => {
        if (x !== null) {
          const w = width()
          const travelled = s.opening ? x + w : -x
          const commit = travelled > w * COMMIT_FRACTION
          onOpenChange(s.opening ? commit : !commit)
        }
        return null
      })
    }

    // `passive: false` on touchmove so preventDefault() is honoured.
    document.addEventListener('touchstart', onStart, { passive: true })
    document.addEventListener('touchmove', onMove, { passive: false })
    document.addEventListener('touchend', onEnd)
    document.addEventListener('touchcancel', onEnd)
    return () => {
      document.removeEventListener('touchstart', onStart)
      document.removeEventListener('touchmove', onMove)
      document.removeEventListener('touchend', onEnd)
      document.removeEventListener('touchcancel', onEnd)
    }
  }, [onOpenChange])

  const dragging = dragX !== null
  const panelStyle = dragging
    ? { transform: `translateX(${dragX}px)`, transition: 'none' }
    : undefined
  const w = panelRef.current?.offsetWidth ?? 280
  const progress = dragging ? 1 + dragX / w : open ? 1 : 0
  const backdropStyle = dragging ? { opacity: progress, transition: 'none' } : undefined
  const visible = open || dragging

  return (
    <>
      <div
        className={`drawer-backdrop${visible ? ' visible' : ''}`}
        style={backdropStyle}
        onClick={() => onOpenChange(false)}
        aria-hidden="true"
      />
      <nav
        ref={panelRef}
        className={`drawer${open ? ' open' : ''}`}
        style={panelStyle}
        aria-label="Навигация"
        aria-hidden={!visible}
      >
        <div className="drawer-title">Deutsch üben</div>
        <ul className="drawer-list">
          {PAGES.map((p) => (
            <li key={p.path}>
              <NavLink
                to={p.path}
                end
                className={({ isActive }) => `drawer-link${isActive ? ' active' : ''}`}
                onClick={() => onOpenChange(false)}
              >
                {p.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </>
  )
}
