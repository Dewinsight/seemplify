import { type FormEvent, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ProfileForm, type ProfileValues } from '@/components/account/ProfileForm';
import { api, json } from '@/lib/api';
import type { UserProfile } from '@/types';

interface ProfileResponse { profile: UserProfile; emailVerified: boolean; onboardingRequired: boolean }

export function ProfilePage() {
  const [value, setValue] = useState<ProfileValues | null>(null);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  useEffect(() => { void api<ProfileResponse>('/api/account/profile').then(({ profile }) => setValue(profile)).catch((reason) => setError(reason instanceof Error ? reason.message : 'Could not load your profile.')); }, []);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!value) return;
    try {
      setWorking(true); setError('');
      const result = await api<ProfileResponse>('/api/account/profile', json('PUT', {
        name: value.name,
        jobTitle: value.jobTitle,
        organizationName: value.organizationName,
        timezone: value.timezone,
        primaryGoal: value.primaryGoal
      }));
      setValue(result.profile); toast.success('Profile saved');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save your profile.'); }
    finally { setWorking(false); }
  }
  return <div className="max-w-3xl space-y-6">
    <div><h1 className="page-title">Your profile</h1><p className="page-description">Manage the personal details used across your Experience Management workspace.</p></div>
    {error && <div className="border border-destructive/35 bg-card p-4 text-sm text-destructive" role="alert">{error}</div>}
    {value && <section className="border bg-card p-5 sm:p-6"><ProfileForm value={value} onChange={setValue} onSubmit={submit} working={working} /></section>}
  </div>;
}
