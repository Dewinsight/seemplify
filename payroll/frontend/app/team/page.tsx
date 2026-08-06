'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authApi, handleAuthCallback, isAuthenticated } from '@/lib/api';
import Link from 'next/link';
import { ArrowRight, Loader2, Users } from 'lucide-react';

export default function TeamPageRedirect() {
  const router = useRouter();
  const [destination, setDestination] = useState('/dashboard');

  useEffect(() => {
    handleAuthCallback();

    if (!isAuthenticated()) {
      router.push('/login');
      return;
    }

    (async () => {
      try {
        const me = await authApi.getMe();
        const currentOrgId = me.currentOrganizationId;
        const currentOrg =
          me.user?.organizations?.find((o: any) => o.id === currentOrgId) ||
          me.user?.organizations?.[0];

        const isHRAdmin = !!currentOrg && ['owner', 'admin', 'hr_manager'].includes(currentOrg.role);
        const nextPath = isHRAdmin ? '/admin/employees' : '/requests';

        setDestination(nextPath);
        router.replace(nextPath);
      } catch (err) {
        console.error('Failed to resolve team redirect:', err);
        router.replace('/dashboard');
      }
    })();
  }, [router]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-200 p-8 pb-20 flex items-center justify-center">
      <div className="max-w-lg w-full bg-zinc-900/70 border border-zinc-800 rounded-2xl p-8 text-center">
        <div className="w-14 h-14 rounded-xl bg-zinc-800/70 mx-auto mb-4 flex items-center justify-center">
          <Users className="w-7 h-7 text-zinc-400" />
        </div>
        <h1 className="text-xl font-semibold text-zinc-100">Team Workspace Moved</h1>
        <p className="text-sm text-zinc-500 mt-2">
          Payroll now uses unified employee management with team filters.
        </p>
        <div className="mt-5 flex items-center justify-center gap-2 text-zinc-400 text-sm">
          <Loader2 className="w-4 h-4 animate-spin" />
          Redirecting...
        </div>
        <Link
          href={destination}
          className="mt-5 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-sm"
        >
          Continue
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </div>
  );
}
