'use client'

import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { Check, LoaderCircle, X } from 'lucide-react'
import { ensureAttributionState, trackMarketingVisit } from '@/lib/marketingAttribution'
import { hasAcceptedMarketingConsent } from '@/lib/marketingConsent'
import { idpUrl } from '@/app/site-config'

interface BookDemoModalProps {
  isOpen: boolean
  onClose: () => void
}

interface BookDemoButtonProps {
  children?: ReactNode
  className?: string
  onClick?: () => void
  trackingLabel?: string
}

const emptyForm = {
  name: '',
  email: '',
  company: '',
  role: '',
  message: '',
}

export function BookDemoButton({
  children = 'Book a demo',
  className = 'marketing-button marketing-button--secondary',
  onClick,
  trackingLabel = 'book-demo',
}: BookDemoButtonProps) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        className={className}
        data-track-cta={trackingLabel}
        onClick={() => {
          onClick?.()
          setIsOpen(true)
        }}
      >
        {children}
      </button>
      <BookDemoModal isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </>
  )
}

export default function BookDemoModal({ isOpen, onClose }: BookDemoModalProps) {
  const [formData, setFormData] = useState(emptyForm)
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!isOpen) return

    const previouslyFocused = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeButtonRef.current?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }

      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), a[href]'
        )
      )
      if (!focusable.length) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
      previouslyFocused?.focus()
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setStatus('submitting')
    setErrorMessage('')
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 20_000)

    try {
      let attribution: ReturnType<typeof ensureAttributionState> | null = null
      if (hasAcceptedMarketingConsent()) {
        try {
          attribution = ensureAttributionState()
        } catch {
          // Demo requests must still work when storage is blocked.
        }
      }

      const response = await fetch('/api/book-demo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          ...formData,
          visitorId: attribution?.visitorId,
          sessionId: attribution?.sessionId,
          attributionToken: attribution?.attributionToken,
          utm_source: attribution?.utmSource,
          utm_medium: attribution?.utmMedium,
          utm_campaign: attribution?.utmCampaign,
          utm_term: attribution?.utmTerm,
          utm_content: attribution?.utmContent,
          landingPage: attribution?.landingPage,
          referrer: attribution?.referrer,
        }),
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload?.error || payload?.message || 'We could not send your request. Please try again.')
      }

      trackMarketingVisit(idpUrl('/api/public/marketing/visit'), {
        eventType: 'demo_submit',
        sourceApp: 'marketing-site',
        source: 'marketing-site',
        channel: 'web',
        pageUrl: window.location.href,
        path: window.location.pathname,
        referrer: document.referrer,
        eventLabel: 'book-demo-modal',
      }).catch(() => {})

      setStatus('success')
      window.setTimeout(() => {
        onClose()
        setStatus('idle')
        setFormData(emptyForm)
      }, 2500)
    } catch (error) {
      const message =
        error instanceof DOMException && error.name === 'AbortError'
          ? 'The request took too long. Please check your connection and try again.'
          : error instanceof Error
            ? error.message
            : 'We could not send your request. Please try again.'
      setErrorMessage(message)
      setStatus('error')
    } finally {
      window.clearTimeout(timeout)
    }
  }

  return createPortal(
    <div className="marketing-dialog" role="presentation">
      <button
        type="button"
        className="marketing-dialog__backdrop"
        aria-label="Close demo request"
        onClick={onClose}
        tabIndex={-1}
      />
      <div
        ref={dialogRef}
        className="marketing-dialog__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="book-demo-title"
        aria-describedby="book-demo-description"
      >
        <button
          ref={closeButtonRef}
          type="button"
          className="marketing-dialog__close"
          onClick={onClose}
          aria-label="Close dialog"
        >
          <X aria-hidden="true" size={18} />
        </button>

        {status === 'success' ? (
          <div className="marketing-dialog__success" role="status" aria-live="polite">
            <span className="marketing-dialog__success-icon"><Check aria-hidden="true" size={22} /></span>
            <p className="marketing-eyebrow">Request received</p>
            <h2 id="book-demo-title">We’ll be in touch.</h2>
            <p id="book-demo-description">
              A member of the Seemplify team will contact you shortly to plan your walkthrough.
            </p>
          </div>
        ) : (
          <>
            <div className="marketing-dialog__heading">
              <p className="marketing-eyebrow">A guided walkthrough</p>
              <h2 id="book-demo-title">Book a demo</h2>
              <p id="book-demo-description">
                Tell us a little about your team. We’ll shape the conversation around the workflows you want to improve.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="marketing-form">
              <div className="marketing-form__row">
                <div className="marketing-field">
                  <label htmlFor="demo-name">Name</label>
                  <input
                    id="demo-name"
                    required
                    autoComplete="name"
                    value={formData.name}
                    onChange={(event) => setFormData({ ...formData, name: event.target.value })}
                  />
                </div>
                <div className="marketing-field">
                  <label htmlFor="demo-company">Company</label>
                  <input
                    id="demo-company"
                    required
                    autoComplete="organization"
                    value={formData.company}
                    onChange={(event) => setFormData({ ...formData, company: event.target.value })}
                  />
                </div>
              </div>

              <div className="marketing-field">
                <label htmlFor="demo-email">Work email</label>
                <input
                  id="demo-email"
                  required
                  type="email"
                  autoComplete="email"
                  value={formData.email}
                  onChange={(event) => setFormData({ ...formData, email: event.target.value })}
                />
              </div>

              <div className="marketing-field">
                <label htmlFor="demo-role">Your role <span>Optional</span></label>
                <input
                  id="demo-role"
                  autoComplete="organization-title"
                  value={formData.role}
                  onChange={(event) => setFormData({ ...formData, role: event.target.value })}
                />
              </div>

              <div className="marketing-field">
                <label htmlFor="demo-message">What would you like to improve? <span>Optional</span></label>
                <textarea
                  id="demo-message"
                  rows={3}
                  value={formData.message}
                  onChange={(event) => setFormData({ ...formData, message: event.target.value })}
                />
              </div>

              {errorMessage && (
                <p className="marketing-form__error" role="alert">{errorMessage}</p>
              )}

              <button
                type="submit"
                className="marketing-button marketing-button--primary marketing-form__submit"
                disabled={status === 'submitting'}
              >
                {status === 'submitting' ? (
                  <><LoaderCircle className="marketing-spin" aria-hidden="true" size={17} /> Sending request…</>
                ) : 'Book my walkthrough'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>,
    document.body
  )
}
