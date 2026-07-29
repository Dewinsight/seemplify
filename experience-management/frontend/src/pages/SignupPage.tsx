import { type FormEvent, useState } from 'react';
import { Loader2, UserPlus } from 'lucide-react';
import { Link, useNavigate } from '@/lib/router';
import { api, json } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function SignupPage() {
  const navigate = useNavigate();
  const [name, setName] = useState(''); const [email, setEmail] = useState('');
  const [password, setPassword] = useState(''); const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(''); const [working, setWorking] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setError('');
    if (password !== confirm) return setError('Passwords do not match.');
    try {
      setWorking(true);
      await api('/api/auth/signup', json('POST', { name, email, password }));
      navigate('/');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not create account'); }
    finally { setWorking(false); }
  }
  return <main className="grid min-h-screen place-items-center bg-background p-5"><div className="w-full max-w-sm">
    <div className="mb-8 flex items-center gap-3"><div className="grid h-9 w-9 place-items-center rounded-md bg-primary text-sm font-bold text-primary-foreground">S</div><div><div className="text-sm font-semibold">Seemplify</div><div className="text-xs text-muted-foreground">Experience management</div></div></div>
    <div className="border bg-card p-6 shadow-panel"><div className="flex items-center gap-2"><UserPlus className="h-4 w-4 text-primary" /><h1 className="text-lg font-semibold">Create your account</h1></div><p className="mt-2 text-sm leading-6 text-muted-foreground">Join the shared Experience workspace for surveys, journeys, and research intelligence.</p>
      <form className="mt-6 space-y-4" onSubmit={submit}><div><Label className="field-label" htmlFor="name">Name</Label><Input id="name" autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} required minLength={2} /></div><div><Label className="field-label" htmlFor="email">Email</Label><Input id="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></div><div><Label className="field-label" htmlFor="password">Password</Label><Input id="password" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={12} /><p className="mt-1 text-xs text-muted-foreground">12+ characters with uppercase, lowercase, and a number.</p></div><div><Label className="field-label" htmlFor="confirm-password">Confirm password</Label><Input id="confirm-password" type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} required minLength={12} /></div>{error && <p className="text-sm text-destructive" role="alert">{error}</p>}<p className="text-xs leading-5 text-muted-foreground">By creating an account, you agree to the <Link className="text-foreground underline" to="/legal/terms">Terms</Link> and acknowledge the <Link className="text-foreground underline" to="/legal/privacy">Privacy Policy</Link>.</p><Button className="w-full" disabled={working}>{working ? <Loader2 className="animate-spin" /> : <UserPlus />}{working ? 'Creating account' : 'Create account'}</Button></form>
    </div><p className="mt-4 text-center text-xs text-muted-foreground">Already have an account? <Link className="font-medium text-foreground underline-offset-4 hover:underline" to="/login">Sign in</Link></p>
  </div></main>;
}
