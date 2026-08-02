import type { FormEvent } from 'react';
import { Loader2, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { ProfileGoal, UserProfile } from '@/types';

export interface ProfileValues extends Pick<UserProfile, 'name' | 'email' | 'jobTitle' | 'organizationName' | 'timezone' | 'primaryGoal'> {
  spaceName?: string;
}

const goals: Array<{ value: Exclude<ProfileGoal, null>; label: string; description: string }> = [
  { value: 'customer_experience', label: 'Customer experience', description: 'Understand customers and improve service.' },
  { value: 'employee_experience', label: 'Employee experience', description: 'Listen to people across the workplace.' },
  { value: 'market_research', label: 'Market research', description: 'Explore audiences, needs, and opportunities.' },
  { value: 'all_experience', label: 'A connected view', description: 'Bring several experience programmes together.' }
];

export function ProfileForm({ value, onChange, onSubmit, working, onboarding = false }: {
  value: ProfileValues;
  onChange: (next: ProfileValues) => void;
  onSubmit: (event: FormEvent) => void;
  working: boolean;
  onboarding?: boolean;
}) {
  const initials = value.name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'EM';
  const change = <K extends keyof ProfileValues>(key: K, next: ProfileValues[K]) => onChange({ ...value, [key]: next });
  return <form className="space-y-7" onSubmit={onSubmit}>
    <section aria-labelledby="profile-details-heading">
      <div className="mb-4 flex items-center gap-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center bg-primary text-sm font-semibold text-primary-foreground" aria-hidden="true">{initials}</div>
        <div><h2 id="profile-details-heading" className="text-sm font-semibold">About you</h2><p className="mt-0.5 text-xs text-muted-foreground">Enough context to make your workspace feel like yours.</p></div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><Label className="field-label" htmlFor="profile-name">Full name</Label><Input id="profile-name" value={value.name} onChange={(event) => change('name', event.target.value)} required minLength={2} maxLength={100} autoFocus={onboarding} /></div>
        <div><Label className="field-label" htmlFor="profile-job-title">Job title <span className="font-normal text-muted-foreground">(optional)</span></Label><Input id="profile-job-title" value={value.jobTitle} onChange={(event) => change('jobTitle', event.target.value)} maxLength={100} placeholder="Customer insight lead" /></div>
        <div><Label className="field-label" htmlFor="profile-organization">Organisation <span className="font-normal text-muted-foreground">(optional)</span></Label><Input id="profile-organization" value={value.organizationName} onChange={(event) => change('organizationName', event.target.value)} maxLength={120} placeholder="Organisation name" /></div>
        <div><Label className="field-label" htmlFor="profile-email">Email</Label><Input id="profile-email" value={value.email} readOnly aria-readonly="true" className="bg-muted/35" /></div>
        <div><Label className="field-label" htmlFor="profile-timezone">Timezone</Label><Input id="profile-timezone" value={value.timezone} onChange={(event) => change('timezone', event.target.value)} required maxLength={100} /></div>
        {onboarding && <div className="sm:col-span-2"><Label className="field-label" htmlFor="profile-space-name">Personal space name <span className="font-normal text-muted-foreground">(optional)</span></Label><Input id="profile-space-name" value={value.spaceName || ''} onChange={(event) => change('spaceName', event.target.value)} minLength={2} maxLength={100} /><p className="mt-1 text-xs text-muted-foreground">Rename your existing private space. This will not create another one.</p></div>}
      </div>
    </section>
    <fieldset>
      <legend className="text-sm font-semibold">What do you want to understand first?</legend>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">This sets a starting focus; it does not restrict any feature.</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {goals.map((goal) => <label className={cn('cursor-pointer border px-3.5 py-3 transition-colors', value.primaryGoal === goal.value ? 'border-primary bg-accent/55' : 'bg-card hover:bg-muted/35')} key={goal.value}>
          <span className="flex items-start gap-2.5"><input className="mt-1 border-input text-primary focus:ring-primary" type="radio" name="primary-goal" value={goal.value} checked={value.primaryGoal === goal.value} onChange={() => change('primaryGoal', goal.value)} required /><span><span className="block text-sm font-medium">{goal.label}</span><span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{goal.description}</span></span></span>
        </label>)}
      </div>
    </fieldset>
    <Button className={cn('h-10', onboarding && 'w-full')} disabled={working || value.name.trim().length < 2 || !value.timezone.trim() || !value.primaryGoal}>{working ? <Loader2 className="animate-spin" /> : <Save />}{working ? 'Saving profile' : onboarding ? 'Finish setup' : 'Save profile'}</Button>
  </form>;
}
