'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2 } from 'lucide-react';
import api from '@/lib/api';

type Cycle = { _id: string; cycleNumber: string; status: string; payPeriod: { month: number; year: number; paymentDate: string }; childRuns: unknown[]; revision: number };
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function PayrollCyclesPage() {
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => { api.get('/payroll/cycles?limit=50').then(response => setCycles(response.data || [])).catch(requestError => setError(requestError?.response?.data?.error || 'Unable to load payroll cycles.')).finally(() => setLoading(false)); }, []);
  if (loading) return <main className="min-h-screen bg-zinc-950 grid place-items-center"><Loader2 className="h-7 w-7 animate-spin text-amber-400" /></main>;
  return <main className="min-h-screen bg-zinc-950 px-6 py-8 text-zinc-200"><div className="mx-auto max-w-5xl"><Link href="/dashboard" className="inline-flex items-center gap-1 text-sm text-zinc-400"><ArrowLeft className="h-4 w-4" /> Dashboard</Link><div className="mt-3 flex items-end justify-between gap-4"><div><h1 className="text-2xl font-semibold">Payroll cycles</h1><p className="mt-1 text-sm text-zinc-500">Coordinated payroll across legal employers and currencies.</p></div><Link href="/admin/run" className="bg-amber-500 px-4 py-2.5 text-sm font-semibold text-zinc-950">New cycle</Link></div>{error && <div role="alert" className="mt-5 border border-red-500/30 bg-red-950/20 px-4 py-3 text-sm text-red-200">{error}</div>}<section className="mt-6 border border-zinc-800 bg-zinc-900/50"><div className="divide-y divide-zinc-800">{cycles.map(cycle => <Link key={cycle._id} href={`/admin/cycles/${cycle._id}`} className="flex items-center justify-between gap-5 px-5 py-4 hover:bg-zinc-800/50"><div><p className="font-medium text-zinc-100">{months[cycle.payPeriod.month - 1]} {cycle.payPeriod.year}</p><p className="mt-1 font-mono text-xs text-zinc-500">{cycle.cycleNumber} · revision {cycle.revision}</p></div><div className="text-right"><p className="text-sm capitalize text-zinc-300">{cycle.status.replaceAll('_', ' ')}</p><p className="mt-1 text-xs text-zinc-500">{cycle.childRuns.length} legal employer{cycle.childRuns.length === 1 ? '' : 's'}</p></div></Link>)}{!cycles.length && !error && <p className="px-5 py-10 text-center text-sm text-zinc-500">No payroll cycles yet.</p>}</div></section></div></main>;
}
