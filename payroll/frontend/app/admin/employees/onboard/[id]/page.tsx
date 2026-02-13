'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import api, { authApi, handleAuthCallback, isAuthenticated } from '@/lib/api';
import { AlertCircle, ArrowLeft, Loader2 } from 'lucide-react';

export default function OnboardEmployeePage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

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
          me.user?.organizations?.find((o: any) => o.id === currentOrgId) || me.user?.organizations?.[0];
        const isHr = currentOrg && ['owner', 'admin', 'hr_manager'].includes(currentOrg.role);
        if (!isHr) {
          router.push('/dashboard');
          return;
        }

        await api.post('/payroll/profiles/import-from-idp', { userId: params.id });
        router.replace(`/admin/employees/${params.id}`);
      } catch (e: any) {
        setError(e?.response?.data?.error || e?.message || 'Failed to onboard employee');
      }
    })();
  }, [params.id, router]);

  if (error) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-200 p-8 pb-20">
        <div className="max-w-3xl mx-auto">
          <Link
            href="/admin/employees"
            className="inline-flex items-center text-sm text-zinc-400 hover:text-amber-400 mb-4 transition-colors"
          >
            <ArrowLeft className="w-4 h-4 mr-1" />
            Back to Employees
          </Link>

          <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-6">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-orange-400" />
              <div className="text-zinc-300">{error}</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
      <div className="text-center">
        <Loader2 className="w-10 h-10 text-amber-500 animate-spin mx-auto mb-4" />
        <div className="text-zinc-300 font-medium">Onboarding employee...</div>
        <div className="text-zinc-500 text-sm mt-1">Creating payroll profile and syncing from Identity Provider</div>
      </div>
    </div>
  );
}

