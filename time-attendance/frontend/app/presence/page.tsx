'use client';

import { useEffect, useState } from 'react';
import { Download, Eye, FileQuestion, MonitorCheck, ShieldCheck } from 'lucide-react';
import { presenceApi } from '@/lib/api';

const stateLabels: Record<string, string> = {
    matched: 'Expected evidence available',
    clocked_without_expected_evidence: 'Expected evidence not recently available',
    activity_outside_attendance: 'Evidence outside clocked time',
    evidence_unavailable: 'Evidence unavailable',
};

export default function PresencePage() {
    const [data, setData] = useState<any>(null);
    const [notice, setNotice] = useState<any>(null);
    const [requests, setRequests] = useState<any[]>([]);
    const [message, setMessage] = useState('');
    const load = async () => {
        const [mine, policy, privacy] = await Promise.all([presenceApi.me(), presenceApi.notice(), presenceApi.privacyRequests()]);
        setData(mine); setNotice(policy); setRequests(privacy.requests || []);
    };
    useEffect(() => { void load().catch(() => setMessage('Presence evidence could not be loaded.')); }, []);
    const exportMine = async () => {
        const payload = await presenceApi.exportMine();
        const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
        const link = document.createElement('a'); link.href = url; link.download = 'my-presence-evidence.json'; link.click(); URL.revokeObjectURL(url);
    };
    const request = async (type: string) => {
        const reason = window.prompt(`Tell HR why you are requesting ${type} of your presence evidence.`);
        if (!reason) return;
        await presenceApi.requestPrivacyAction(type, reason); setMessage('Your request was submitted to HR.'); await load();
    };

    if (!data || !notice) return <div className="py-20 text-center text-zinc-400">Loading your evidence…</div>;
    const comparison = data.comparison || {};
    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-2xl font-semibold text-white">My application presence</h1><p className="mt-1 text-sm text-zinc-400">Transparent supporting evidence alongside attendance—not a measure of productivity.</p></div><button onClick={exportMine} className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800"><Download className="h-4 w-4" />Export my data</button></div>
            {message && <div className="rounded-lg border border-teal-500/30 bg-teal-500/10 px-4 py-3 text-sm text-teal-200">{message}</div>}
            <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
                <div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 text-teal-400" /><div><h2 className="text-sm font-semibold text-white">What is collected</h2><p className="mt-1 max-w-3xl text-sm leading-6 text-zinc-400">{notice.purpose}</p><div className="mt-3 text-xs text-zinc-500">Raw events: {notice.rawRetentionDays} days · Daily summaries: {notice.dailySummaryRetentionDays} days</div></div></div>
                <div className="mt-4 grid gap-4 border-t border-zinc-800 pt-4 md:grid-cols-2"><div><div className="text-xs font-medium uppercase tracking-wide text-zinc-500">Included</div><p className="mt-2 text-sm leading-6 text-zinc-300">{notice.captured.join(' · ')}</p></div><div><div className="text-xs font-medium uppercase tracking-wide text-zinc-500">Never included</div><p className="mt-2 text-sm leading-6 text-zinc-300">{notice.excluded.join(' · ')}</p></div></div>
            </section>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4"><div className="text-xs text-zinc-500">Comparison</div><div className="mt-2 text-sm font-medium text-white">{stateLabels[comparison.state] || comparison.state}</div></div>
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4"><div className="text-xs text-zinc-500">Sessions in attendance</div><div className="mt-2 text-2xl font-semibold text-white">{comparison.sessionsDuringAttendance || 0}</div></div>
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4"><div className="text-xs text-zinc-500">Apps seen</div><div className="mt-2 text-sm font-medium text-white">{comparison.appsSeen?.join(', ') || 'None'}</div></div>
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4"><div className="text-xs text-zinc-500">Expected but unavailable</div><div className="mt-2 text-sm font-medium text-white">{comparison.missingExpectedApps?.join(', ') || 'None'}</div></div>
            </div>
            <section className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/50"><div className="border-b border-zinc-800 px-5 py-4"><h2 className="text-sm font-semibold text-white">Recent sessions</h2></div>{data.sessions?.length ? data.sessions.map((item: any) => <div key={item._id} className="grid gap-2 border-b border-zinc-800 px-5 py-4 text-sm last:border-0 sm:grid-cols-[1fr_1fr_auto]"><div className="flex items-center gap-2 text-zinc-200"><MonitorCheck className="h-4 w-4 text-teal-400" />{item.appId}</div><div className="text-zinc-400">{new Date(item.startedAt).toLocaleString()} – {item.endedAt ? new Date(item.endedAt).toLocaleString() : item.status}</div><div className="text-xs text-zinc-500">Last activity {item.lastActivityAt ? new Date(item.lastActivityAt).toLocaleString() : 'not reported'}</div></div>) : <div className="p-8 text-center text-sm text-zinc-500">No presence evidence in this period.</div>}</section>
            <section className="grid gap-4 lg:grid-cols-[1fr_320px]"><div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5"><div className="flex gap-3"><Eye className="h-5 w-5 text-zinc-500" /><div><h2 className="text-sm font-semibold text-white">Your rights and requests</h2><p className="mt-1 text-sm leading-6 text-zinc-400">Ask HR to correct, delete, or review use of this evidence. Requests and any HR access are audited.</p><div className="mt-4 flex flex-wrap gap-2">{['access', 'correction', 'deletion', 'objection'].map(type => <button key={type} onClick={() => request(type)} className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs capitalize text-zinc-300 hover:bg-zinc-800">{type}</button>)}</div></div></div></div><div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5"><div className="flex items-center gap-2 text-sm font-semibold text-white"><FileQuestion className="h-4 w-4 text-zinc-500" />Open requests</div><div className="mt-3 space-y-2">{requests.length ? requests.slice(0, 5).map(item => <div key={item._id} className="flex justify-between text-xs"><span className="capitalize text-zinc-300">{item.type}</span><span className="text-zinc-500">{item.status.replace('_', ' ')}</span></div>) : <p className="text-xs text-zinc-500">No requests submitted.</p>}</div></div></section>
        </div>
    );
}
