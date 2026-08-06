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
        className="fixed bottom-6 right-6 z-40 inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-zinc-950/95 px-4 py-3 text-sm font-medium text-amber-200 shadow-2xl shadow-black/40 backdrop-blur-xl transition hover:border-amber-400/50 hover:bg-zinc-900"
      >
        <HelpCircle className="h-4 w-4" />
        Page Guide
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
            onClick={closeGuide}
          />
          <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-zinc-800 bg-zinc-950/98 shadow-2xl shadow-black/50">
            <div className="flex items-start justify-between gap-4 border-b border-zinc-800 px-6 py-5">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.14em] text-amber-300">
                  <BookOpen className="h-3.5 w-3.5" />
                  {guide.audience}
                </div>
                <h2 className="mt-3 text-2xl font-semibold text-white">{guide.title}</h2>
                <p className="mt-2 text-sm leading-6 text-zinc-400">{guide.summary}</p>
              </div>
              <button
                type="button"
                onClick={closeGuide}
                className="rounded-full border border-zinc-700 p-2 text-zinc-400 transition hover:border-zinc-500 hover:text-white"
                aria-label="Close page guide"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
              <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
                <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-zinc-100">
                  <ChevronRight className="h-4 w-4 text-amber-400" />
                  How To Use This Page
                </div>
                <ol className="space-y-3">
                  {guide.steps.map((step, index) => (
                    <li key={`${guide.id}-step-${index}`} className="flex gap-3 text-sm leading-6 text-zinc-300">
                      <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-xs font-semibold text-amber-300">
                        {index + 1}
                      </span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              </section>

              <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
                <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-zinc-100">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  Before You Leave
                </div>
                <ul className="space-y-3">
                  {guide.checks.map((check, index) => (
                    <li key={`${guide.id}-check-${index}`} className="flex gap-3 text-sm leading-6 text-zinc-300">
                      <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-400/80" />
                      <span>{check}</span>
                    </li>
                  ))}
                </ul>
              </section>

              {!!guide.tips?.length && (
                <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
                  <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-zinc-100">
                    <Lightbulb className="h-4 w-4 text-blue-400" />
                    Helpful Tips
                  </div>
                  <ul className="space-y-3">
                    {guide.tips.map((tip, index) => (
                      <li key={`${guide.id}-tip-${index}`} className="flex gap-3 text-sm leading-6 text-zinc-300">
                        <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-blue-400/80" />
                        <span>{tip}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {!!guide.related?.length && (
                <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
                  <div className="mb-4 text-sm font-semibold text-zinc-100">Go Next</div>
                  <div className="flex flex-wrap gap-2">
                    {guide.related.map((link) => (
                      <Link
                        key={`${guide.id}-${link.href}`}
                        href={link.href}
                        onClick={closeGuide}
                        className="inline-flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 transition hover:border-amber-500/30 hover:text-white"
                      >
                        {link.label}
                        <ChevronRight className="h-4 w-4 text-zinc-500" />
                      </Link>
                    ))}
                  </div>
                </section>
              )}
            </div>
          </aside>
        </>
      )}
    </>
  );
}
