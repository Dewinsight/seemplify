'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BookOpen, CheckCircle2, ChevronRight, HelpCircle, Lightbulb, X } from 'lucide-react';

import { resolvePageGuide } from '@/lib/pageGuide';

const GUIDE_SEEN_STORAGE_KEY = 'payroll:page-guide:seen:';

export default function PageGuide() {
  const pathname = usePathname();
  const guide = useMemo(() => resolvePageGuide(pathname), [pathname]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const seen = window.localStorage.getItem(`${GUIDE_SEEN_STORAGE_KEY}${guide.id}`) === '1';
    setOpen(!seen);
  }, [guide.id]);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        window.localStorage.setItem(`${GUIDE_SEEN_STORAGE_KEY}${guide.id}`, '1');
        setOpen(false);
      }
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [guide.id, open]);

  const closeGuide = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(`${GUIDE_SEEN_STORAGE_KEY}${guide.id}`, '1');
    }
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="payroll-guide-trigger"
      >
        <HelpCircle className="h-4 w-4" />
        Page Guide
      </button>

      {open && (
        <>
          <div
            className="payroll-overlay"
            onClick={closeGuide}
            aria-hidden="true"
          />
          <aside
            className="payroll-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="payroll-guide-title"
            aria-describedby="payroll-guide-summary"
          >
            <header className="payroll-guide-header flex items-start justify-between gap-4">
              <div>
                <div className="payroll-guide-audience">
                  <BookOpen className="h-4 w-4" />
                  {guide.audience}
                </div>
                <h2 id="payroll-guide-title" className="payroll-guide-title mt-3 text-2xl font-semibold">{guide.title}</h2>
                <p id="payroll-guide-summary" className="payroll-guide-copy mt-2 text-sm leading-6">{guide.summary}</p>
              </div>
              <button
                type="button"
                onClick={closeGuide}
                className="payroll-dialog-close"
                aria-label="Close page guide"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="payroll-guide-body">
              <section className="payroll-guide-section">
                <h3 className="payroll-guide-heading">
                  <ChevronRight className="h-4 w-4" style={{ color: 'var(--payroll-popup-accent)' }} />
                  How To Use This Page
                </h3>
                <ol className="payroll-guide-list">
                  {guide.steps.map((step, index) => (
                    <li key={`${guide.id}-step-${index}`} className="payroll-guide-row">
                      <span className="payroll-guide-index">
                        {index + 1}
                      </span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              </section>

              <section className="payroll-guide-section">
                <h3 className="payroll-guide-heading">
                  <CheckCircle2 className="h-4 w-4" style={{ color: 'var(--payroll-popup-positive)' }} />
                  Before You Leave
                </h3>
                <ul className="payroll-guide-list">
                  {guide.checks.map((check, index) => (
                    <li key={`${guide.id}-check-${index}`} className="payroll-guide-row">
                      <CheckCircle2 className="payroll-guide-marker h-4 w-4 shrink-0" />
                      <span>{check}</span>
                    </li>
                  ))}
                </ul>
              </section>

              {!!guide.tips?.length && (
                <section className="payroll-guide-section">
                  <h3 className="payroll-guide-heading">
                    <Lightbulb className="h-4 w-4" style={{ color: 'var(--payroll-popup-accent)' }} />
                    Helpful Tips
                  </h3>
                  <ul className="payroll-guide-list">
                    {guide.tips.map((tip, index) => (
                      <li key={`${guide.id}-tip-${index}`} className="payroll-guide-row">
                        <Lightbulb className="payroll-guide-marker h-4 w-4 shrink-0" />
                        <span>{tip}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {!!guide.related?.length && (
                <section className="payroll-guide-section">
                  <h3 className="payroll-guide-heading">Related pages</h3>
                  <div className="payroll-guide-links">
                    {guide.related.map((link) => (
                      <Link
                        key={`${guide.id}-${link.href}`}
                        href={link.href}
                        onClick={closeGuide}
                        className="payroll-button-secondary"
                      >
                        {link.label}
                        <ChevronRight className="h-4 w-4" />
                      </Link>
                    ))}
                  </div>
                </section>
              )}
            </div>

            <footer className="payroll-guide-footer">
              <button type="button" onClick={closeGuide} className="payroll-button-primary w-full">
                Done
              </button>
            </footer>
          </aside>
        </>
      )}
    </>
  );
}
