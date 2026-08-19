import { ArrowRight, House, LockKeyhole } from 'lucide-react';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { Button } from '@/components/ui/button';

function authenticationReturnPath() {
  const params = new URLSearchParams(window.location.search);
  const inviteToken = params.get('invite') || '';
  if (inviteToken) return `/join/${encodeURIComponent(inviteToken)}`;
  if (params.get('esign') || params.get('returnTo') === '/my-documents') return '/my-documents';
  return '/';
}

export function LoginPage() {
  const error = new URLSearchParams(window.location.search).get('error') || '';
  const startUrl = `/api/auth/oidc/start?returnTo=${encodeURIComponent(authenticationReturnPath())}`;
  return <AuthLayout image="research"><div>
    <div className="flex h-9 w-9 items-center justify-center border bg-card text-primary"><LockKeyhole className="h-4 w-4" /></div>
    <h1 className="mt-5 text-2xl font-semibold tracking-[-0.03em]">Sign in to Experience Management</h1>
    <p className="mt-2 text-sm leading-6 text-muted-foreground">Use your Seemplify account and current organization. Account access, organization membership, and administrator status are managed centrally.</p>
    {error && <div className="mt-5 border border-destructive/35 bg-destructive/5 px-3 py-2.5 text-sm text-destructive" role="alert">{error}</div>}
    <Button className="mt-7 h-10 w-full" asChild>
      <a href={startUrl}>Continue with Seemplify <ArrowRight /></a>
    </Button>
    <Button className="mt-3 h-10 w-full" variant="outline" asChild>
      <a href="/api/auth/hub"><House />Go to Hub</a>
    </Button>
    <p className="mt-6 border-t pt-5 text-center text-xs leading-5 text-muted-foreground">Published surveys and public signing links remain available without signing in.</p>
  </div></AuthLayout>;
}
