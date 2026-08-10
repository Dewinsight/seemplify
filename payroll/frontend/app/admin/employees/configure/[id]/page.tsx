'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import api, { authApi, handleAuthCallback } from '@/lib/api';
import { AlertCircle, ArrowLeft, Loader2 } from 'lucide-react';

export default function ConfigureEmployeePayrollPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    handleAuthCallback();

    (async () => {
      try {
        const me = await authApi.getMe();
        const currentOrgId = me.currentOrganizationId;
        const currentOrg =
          me.user?.organizations?.find((organization: any) => organization.id === currentOrgId)
          || me.user?.organizations?.[0];
        const isHr = currentOrg && ['owner', 'admin', 'hr_manager'].includes(currentOrg.role);
        if (!isHr) {
          router.push('/dashboard');
          return;
        }

        await api.post('/payroll/profiles/sync-from-idp', { userId: params.id });
        router.replace(`/admin/employees/${params.id}`);
      } catch (syncError: any) {
        setError(
          syncError?.response?.data?.error
          || syncError?.message
          || 'Failed to prepare payroll configuration for this IDP member'
        );
      }
    })();
  }, [params.id, router]);

  if (error) {
    return (
      <div className="min-h-screen bg-zinc-950 p-8 pb-20 text-zinc-200">
        <div className="mx-auto max-w-3xl">
          <Link
            href="/admin/employees"
            className="mb-4 inline-flex items-center text-sm text-zinc-400 transition-colors hover:text-amber-400"
          >
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back to Employees
          </Link>

          <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-orange-400" />
              <div>
                <p className="font-medium text-zinc-200">Payroll configuration could not be prepared</p>
                <p className="mt-1 text-sm text-zinc-400">{error}</p>
                <p className="mt-3 text-sm text-zinc-500">
                  Confirm that the person is still a member of the selected Identity Provider organization, then try again.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950">
      <div className="text-center">
        <Loader2 className="mx-auto mb-4 h-10 w-10 animate-spin text-amber-500" />
        <p className="font-medium text-zinc-300">Preparing payroll setup...</p>
        <p className="mt-1 text-sm text-zinc-500">
          Verifying the existing IDP member and loading their payroll configuration.
        </p>
      </div>
    </div>
  );
}
