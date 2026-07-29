import { type FormEvent, useMemo, useState } from 'react';
import { KeyRound, Loader2 } from 'lucide-react';
import { Link, useNavigate } from '@/lib/router';
import { api, json } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const token = useMemo(() => new URLSearchParams(window.location.search).get('token') || '', []);
  const [password, setPassword] = useState(''); const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(''); const [working, setWorking] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setError('');
    if (password !== confirm) return setError('Passwords do not match.');
    try {
      setWorking(true);
      await api('/api/auth/reset-password', json('POST', { token, password }));
      navigate('/');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not reset password'); }
    finally { setWorking(false); }
  }
  return <main className="grid min-h-screen place-items-center bg-background p-5"><div className="w-full max-w-sm">
    <div className="mb-8 flex items-center gap-3"><div className="grid h-9 w-9 place-items-center rounded-md bg-primary text-sm font-bold text-primary-foreground">S</div><div><div className="text-sm font-semibold">Seemplify</div><div className="text-xs text-muted-foreground">Experience management</div></div></div>
    <div className="border bg-card p-6 shadow-panel"><div className="flex items-center gap-2"><KeyRound className="h-4 w-4 text-primary" /><h1 className="text-lg font-semibold">Choose a new password</h1></div><p className="mt-2 text-sm leading-6 text-muted-foreground">Your reset link is one-time use. Setting a new password signs out your older sessions.</p>
      {token ? <form className="mt-6 space-y-4" onSubmit={submit}><div><Label className="field-label" htmlFor="password">New password</Label><Input id="password" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={12} /><p className="mt-1 text-xs text-muted-foreground">12+ characters with uppercase, lowercase, and a number.</p></div><div><Label className="field-label" htmlFor="confirm-password">Confirm password</Label><Input id="confirm-password" type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} required minLength={12} /></div>{error && <p className="text-sm text-destructive" role="alert">{error}</p>}<Button className="w-full" disabled={working}>{working ? <Loader2 className="animate-spin" /> : <KeyRound />}{working ? 'Saving password' : 'Save new password'}</Button></form> : <div className="mt-6 border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950" role="alert">This reset link is missing its security token. Request a new link.</div>}
    </div><p className="mt-4 text-center text-xs text-muted-foreground"><Link className="font-medium text-foreground underline-offset-4 hover:underline" to="/forgot-password">Request another reset link</Link></p>
  </div></main>;
}
