'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, X } from 'lucide-react';
import {
  PERFORMANCE_AI_ATTENTION_EVENT,
  type PerformanceAIErrorDetail
} from '@/lib/api';

export default function AIActionNotice() {
  const [detail, setDetail] = useState<PerformanceAIErrorDetail | null>(null);

  useEffect(() => {
    const onAttention = (event: Event) => {
      setDetail((event as CustomEvent<PerformanceAIErrorDetail>).detail);
    };
    window.addEventListener(PERFORMANCE_AI_ATTENTION_EVENT, onAttention);
    return () => window.removeEventListener(PERFORMANCE_AI_ATTENTION_EVENT, onAttention);
  }, []);

  if (!detail) return null;

  return (
    <aside className="suite-panel fixed bottom-4 left-4 right-4 z-[90] border p-4 shadow-lg sm:left-auto sm:right-6 sm:w-[25rem]" role="alert" aria-labelledby="performance-ai-attention-title">
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-300" />
        <div className="min-w-0 flex-1">
          <h2 id="performance-ai-attention-title" className="text-sm font-semibold text-[var(--suite-ink)]">AI needs your attention</h2>
          <p className="mt-1 text-sm leading-5 text-[var(--suite-muted)]">{detail.message}</p>
          {detail.retryAfterSeconds ? (
            <p className="mt-1 text-xs text-[var(--suite-subtle)]">Try again in about {detail.retryAfterSeconds} seconds.</p>
          ) : null}
          <Link className="mt-3 inline-flex text-sm font-semibold text-[var(--suite-accent)] underline-offset-4 hover:underline" href="/settings/ai" onClick={() => setDetail(null)}>
            Review AI settings
          </Link>
        </div>
        <button className="-mr-1 -mt-1 inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--suite-muted)] hover:bg-[var(--suite-surface-muted)] hover:text-[var(--suite-ink)]" aria-label="Dismiss AI notice" onClick={() => setDetail(null)} type="button">
          <X className="h-4 w-4" />
        </button>
      </div>
    </aside>
  );
}
