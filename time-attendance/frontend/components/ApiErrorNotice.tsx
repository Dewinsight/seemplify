'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { API_ERROR_EVENT } from '@/lib/apiError';

export default function ApiErrorNotice() {
    const [message, setMessage] = useState('');

    useEffect(() => {
        const showError = (event: Event) => {
            const detail = (event as CustomEvent<{ message?: string }>).detail;
            if (detail?.message) setMessage(detail.message);
        };
        window.addEventListener(API_ERROR_EVENT, showError);
        return () => window.removeEventListener(API_ERROR_EVENT, showError);
    }, []);

    if (!message) return null;
    return (
        <div className="fixed right-4 top-4 z-[100] flex w-[min(420px,calc(100vw-2rem))] items-start gap-3 rounded-md border border-red-600/30 bg-[var(--suite-surface)] px-4 py-3 text-sm text-[var(--suite-ink)] shadow-sm" role="alert">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
            <p className="min-w-0 flex-1 leading-5">{message}</p>
            <button type="button" onClick={() => setMessage('')} aria-label="Dismiss error" className="rounded p-0.5 text-[var(--suite-muted)] hover:text-[var(--suite-ink)]">
                <X className="h-4 w-4" />
            </button>
        </div>
    );
}
