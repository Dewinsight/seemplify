import { type FormEvent, useState } from 'react';
import { ArrowLeft, Loader2, Mail } from 'lucide-react';
import { AuthLayout } from '@/components/auth/AuthLayout';
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
  return <AuthLayout image="research"><div>
    <div className="flex h-10 w-10 items-center justify-center border bg-card text-primary"><Mail className="h-5 w-5" /></div>
    <h1 className="mt-5 text-2xl font-semibold tracking-[-0.03em]">Reset your password</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">Enter your account email. If it exists, we will send a one-time link that expires in 30 minutes.</p>
    {message ? <div className="mt-7 border border-emerald-300 bg-emerald-50 p-4 text-sm leading-6 text-emerald-950" role="status">{message}</div> : <form className="mt-7 space-y-5" onSubmit={submit}><div><Label className="field-label" htmlFor="email">Email</Label><Input id="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoFocus /></div>{error && <div className="border border-destructive/35 bg-destructive/5 px-3 py-2.5 text-sm text-destructive" role="alert">{error}</div>}<Button className="h-10 w-full" disabled={working}>{working ? <Loader2 className="animate-spin" /> : <Mail />}{working ? 'Sending link' : 'Send reset link'}</Button></form>}
    <div className="mt-6 border-t pt-5 text-center text-sm text-muted-foreground"><Link className="inline-flex items-center gap-1 font-medium text-foreground underline-offset-4 hover:underline" to="/login"><ArrowLeft className="h-3.5 w-3.5" />Back to sign in</Link></div>
  </div></AuthLayout>;
}
