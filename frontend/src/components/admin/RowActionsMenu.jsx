import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { MoreIcon } from './icons'

const MENU_WIDTH = 210

// "More actions" menu for a table row. Holds the less frequent and the
// state-changing actions (Activate, Deactivate, Delete) so each row keeps
// a single line. The menu is position:fixed and anchored to its button, so
// a scrolling table never clips it; it closes on outside click, Escape,
// scroll and resize, and supports arrow-key navigation.
//
// items: [{ label, icon, onSelect, danger, disabled, hint }]
export default function RowActionsMenu({ label = 'More actions', items }) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState(null)
  const buttonRef = useRef(null)
  const menuRef = useRef(null)
  const visibleItems = items.filter(Boolean)

  const close = (restoreFocus = false) => {
    setOpen(false)
    if (restoreFocus) buttonRef.current?.focus()
  }

  // Measure the anchor before paint so the menu never flashes elsewhere.
  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return
    const rect = buttonRef.current.getBoundingClientRect()
    const menuHeight = menuRef.current?.offsetHeight ?? 0
    const fitsBelow = rect.bottom + 6 + menuHeight <= window.innerHeight
    setPosition({
      top: fitsBelow ? rect.bottom + 6 : Math.max(8, rect.top - 6 - menuHeight),
      left: Math.max(8, Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8)),
    })
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event) => {
      if (!menuRef.current?.contains(event.target) && !buttonRef.current?.contains(event.target)) {
        close()
      }
    }
    const onDismiss = () => close()
    document.addEventListener('mousedown', onPointerDown)
    window.addEventListener('scroll', onDismiss, true)
    window.addEventListener('resize', onDismiss)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('scroll', onDismiss, true)
      window.removeEventListener('resize', onDismiss)
    }
  }, [open])

  // Focus the first enabled item once the menu is placed.
  useEffect(() => {
    if (open && position) {
      menuRef.current?.querySelector('[role="menuitem"]:not([disabled])')?.focus()
    }
  }, [open, position])

  const handleMenuKeyDown = (event) => {
    const enabled = [...menuRef.current.querySelectorAll('[role="menuitem"]:not([disabled])')]
    const index = enabled.indexOf(document.activeElement)
    if (event.key === 'Escape') {
      event.preventDefault()
      close(true)
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      enabled[(index + 1) % enabled.length]?.focus()
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      enabled[(index - 1 + enabled.length) % enabled.length]?.focus()
    } else if (event.key === 'Tab') {
      close()
    }
  }

  if (visibleItems.length === 0) return null

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`row-menu__trigger${open ? ' row-menu__trigger--open' : ''}`}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <MoreIcon width={18} height={18} />
      </button>
      {open && (
        <div
          ref={menuRef}
          className="row-menu"
          role="menu"
          aria-label={label}
          style={{
            width: MENU_WIDTH,
            top: position?.top ?? -9999,
            left: position?.left ?? -9999,
          }}
          onKeyDown={handleMenuKeyDown}
        >
          {visibleItems.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={`row-menu__item${item.danger ? ' row-menu__item--danger' : ''}`}
              disabled={item.disabled}
              onClick={() => {
                close()
                item.onSelect()
              }}
            >
              {item.icon && <span className="row-menu__icon">{item.icon}</span>}
              <span className="row-menu__text">
                {item.label}
                {item.hint && <span className="row-menu__hint">{item.hint}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </>
  )
}
