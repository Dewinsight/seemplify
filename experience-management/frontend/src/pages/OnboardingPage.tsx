import { type FormEvent, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { AuthLayout, AuthSteps } from '@/components/auth/AuthLayout';
import { ProfileForm, type ProfileValues } from '@/components/account/ProfileForm';
import { api, json, storeActiveSpaceId } from '@/lib/api';
import type { AuthSession } from '@/types';

function browserTimezone() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } }

export function OnboardingPage() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [value, setValue] = useState<ProfileValues | null>(null);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);

  useEffect(() => {
    void api<AuthSession>('/api/auth/session').then((next) => {
      if (!next.authenticated) { window.location.replace('/login'); return; }
      if (!next.emailVerified) { window.location.replace(`/verify-email?email=${encodeURIComponent(next.email || '')}`); return; }
      if (!next.onboardingRequired) { window.location.replace('/'); return; }
      setSession(next);
      setValue({
        name: next.profile?.name || next.user?.name || '', email: next.profile?.email || next.user?.email || '',
        jobTitle: next.profile?.jobTitle || '', organizationName: next.profile?.organizationName || '',
        timezone: next.profile?.timezone || browserTimezone(), primaryGoal: next.profile?.primaryGoal || null,
        spaceName: next.activeSpace?.isPersonal ? next.activeSpace.name : ''
      });
    }).catch((reason) => setError(reason instanceof Error ? reason.message : 'Could not open your profile.'));
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault(); if (!value) return;
    try {
      setWorking(true); setError('');
      const next = await api<AuthSession>('/api/account/onboarding', json('POST', value));
      storeActiveSpaceId(next.activeSpace?.id || session?.activeSpace?.id || null, false);
      window.location.replace('/');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save your profile.'); setWorking(false); }
  }

  return <AuthLayout image="research" wide><div>
    <AuthSteps current={3} />
    <h1 className="text-2xl font-semibold tracking-[-0.03em]">Make the workspace yours</h1>
    <p className="mt-2 max-w-lg text-sm leading-6 text-muted-foreground">A few details help us personalise your starting point. Only your name and research focus are required.</p>
    {error && <div className="mt-5 border border-destructive/35 bg-destructive/5 px-3 py-2.5 text-sm text-destructive" role="alert">{error}</div>}
    <div className="mt-7">{value ? <ProfileForm value={value} onChange={setValue} onSubmit={submit} working={working} onboarding /> : !error && <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Preparing your profile…</div>}</div>
  </div></AuthLayout>;
}
