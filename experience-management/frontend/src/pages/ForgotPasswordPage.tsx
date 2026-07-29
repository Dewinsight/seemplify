import { type FormEvent, useState } from 'react';
import { ArrowLeft, Loader2, Mail } from 'lucide-react';
import { Link } from '@/lib/router';
import { api, json } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState(''); const [message, setMessage] = useState('');
  const [error, setError] = useState(''); const [working, setWorking] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      setWorking(true); setError('');
      const result = await api<{ message: string }>('/api/auth/forgot-password', json('POST', { email }));
      setMessage(result.message);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not request a reset link'); }
    finally { setWorking(false); }
  }
  return <main className="grid min-h-screen place-items-center bg-background p-5"><div className="w-full max-w-sm">
    <div className="mb-8 flex items-center gap-3"><div className="grid h-9 w-9 place-items-center rounded-md bg-primary text-sm font-bold text-primary-foreground">S</div><div><div className="text-sm font-semibold">Seemplify</div><div className="text-xs text-muted-foreground">Experience management</div></div></div>
    <div className="border bg-card p-6 shadow-panel"><div className="flex items-center gap-2"><Mail className="h-4 w-4 text-primary" /><h1 className="text-lg font-semibold">Reset your password</h1></div><p className="mt-2 text-sm leading-6 text-muted-foreground">Enter your account email. If it exists, we will send a one-time link that expires in 30 minutes.</p>
      {message ? <div className="mt-6 border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-950" role="status">{message}</div> : <form className="mt-6 space-y-4" onSubmit={submit}><div><Label className="field-label" htmlFor="email">Email</Label><Input id="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></div>{error && <p className="text-sm text-destructive" role="alert">{error}</p>}<Button className="w-full" disabled={working}>{working ? <Loader2 className="animate-spin" /> : <Mail />}{working ? 'Sending link' : 'Send reset link'}</Button></form>}
    </div><p className="mt-4 text-center text-xs text-muted-foreground"><Link className="inline-flex items-center gap-1 font-medium text-foreground underline-offset-4 hover:underline" to="/login"><ArrowLeft className="h-3 w-3" />Back to sign in</Link></p>
  </div></main>;
}
