'use client';

import { useEffect, useState } from 'react';
import { ExternalLink, ShieldCheck } from 'lucide-react';
import { attendanceAccessApi } from '@/lib/api';

export default function AttendanceRoleSettings() {
    const [manageUrl, setManageUrl] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        void attendanceAccessApi.getPolicy()
            .then(data => setManageUrl(String(data.manageUrl || '')))
            .catch(() => setError('The Identity Provider access page could not be loaded.'))
            .finally(() => setLoading(false));
    }, []);

    return <section aria-labelledby="attendance-role-heading" className="rounded-lg border border-[var(--suite-line-strong)] bg-[var(--suite-surface)] p-5 sm:p-6">
        <div className="flex gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 text-teal-700 dark:text-teal-400" />
            <div className="max-w-3xl">
                <h2 id="attendance-role-heading" className="text-lg font-semibold text-[var(--suite-ink)]">Attendance roles and permissions</h2>
                <p className="mt-1 text-sm leading-6 text-[var(--suite-muted)]">The central Identity Provider owns attendance roles, member assignments, direct exceptions, and the audit history. Changes apply to new OIDC claims across Seemplify products.</p>
                {loading && <p className="mt-4 text-sm text-[var(--suite-muted)]">Loading the Identity Provider link…</p>}
                {error && <p role="alert" className="mt-4 text-sm text-red-700 dark:text-red-300">{error}</p>}
                {!loading && manageUrl && <a href={manageUrl} className="mt-4 inline-flex items-center gap-2 rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 dark:bg-teal-600">Manage in Seemplify Identity <ExternalLink className="h-4 w-4" aria-hidden="true" /></a>}
            </div>
        </div>
    </section>;
}
