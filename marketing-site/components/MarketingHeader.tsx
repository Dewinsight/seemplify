'use client'

import { Menu, X } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { idpUrl } from '@/app/site-config'
import { BookDemoButton } from '@/components/BookDemoModal'
import SeemplifyLogo from '@/components/SeemplifyLogo'
import MarketingThemeToggle from '@/components/MarketingThemeToggle'

const navigation = [
  { href: '/#modules', label: 'Product' },
  { href: '/#how-it-works', label: 'How it works' },
  { href: '/#platform', label: 'Platform' },
  { href: '/#africa', label: 'Africa' },
  { href: '/#faq', label: 'FAQ' },
]

export default function MarketingHeader() {
  const pathname = usePathname()
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const menuButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    setIsMenuOpen(false)
  }, [pathname])

  useEffect(() => {
    if (!isMenuOpen) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setIsMenuOpen(false)
      menuButtonRef.current?.focus()
    }
    const desktopQuery = window.matchMedia('(min-width: 960px)')
    const handleDesktopChange = (event: MediaQueryListEvent) => {
      if (event.matches) setIsMenuOpen(false)
    }

    document.addEventListener('keydown', handleKeyDown)
    desktopQuery.addEventListener('change', handleDesktopChange)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      desktopQuery.removeEventListener('change', handleDesktopChange)
    }
  }, [isMenuOpen])

  const closeMenu = () => setIsMenuOpen(false)

  return (
    <header className="marketing-header">
      <div className="marketing-container marketing-header__inner">
        <Link href="/" className="marketing-header__brand" aria-label="Seemplify home">
          <SeemplifyLogo size="sm" animated={false} className="marketing-header__logo" />
        </Link>

        <nav className="marketing-header__navigation" aria-label="Primary navigation">
          <ul className="marketing-header__navigation-list">
            {navigation.map((item) => (
              <li key={item.href} className="marketing-header__navigation-item">
                <Link href={item.href} className="marketing-header__navigation-link">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="marketing-header__actions">
          <MarketingThemeToggle />
          <Link
            href={idpUrl('/')}
            className="marketing-header__sign-in"
            data-track-cta="header-sign-in"
          >
            Sign in
          </Link>
          <BookDemoButton className="marketing-header__demo">Book a demo</BookDemoButton>
          <button
            ref={menuButtonRef}
            type="button"
            className="marketing-header__menu-toggle"
            aria-label={isMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={isMenuOpen}
            aria-controls="marketing-mobile-menu"
            onClick={() => setIsMenuOpen((open) => !open)}
          >
            {isMenuOpen ? (
              <X className="marketing-header__menu-icon" aria-hidden="true" />
            ) : (
              <Menu className="marketing-header__menu-icon" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      <nav
        id="marketing-mobile-menu"
        className="marketing-header__mobile-navigation"
        aria-label="Mobile navigation"
        data-open={isMenuOpen ? 'true' : 'false'}
        hidden={!isMenuOpen}
      >
        <div className="marketing-container marketing-header__mobile-inner">
          <ul className="marketing-header__mobile-list">
            {navigation.map((item) => (
              <li key={item.href} className="marketing-header__mobile-item">
                <Link
                  href={item.href}
                  className="marketing-header__mobile-link"
                  onClick={closeMenu}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="marketing-header__mobile-actions">
            <Link
              href={idpUrl('/')}
              className="marketing-header__mobile-sign-in"
              data-track-cta="mobile-sign-in"
              onClick={closeMenu}
            >
              Sign in
            </Link>
            <BookDemoButton className="marketing-header__mobile-demo">
              Book a demo
            </BookDemoButton>
          </div>
        </div>
      </nav>
    </header>
  )
}
