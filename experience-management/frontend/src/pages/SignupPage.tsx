import { ArrowRight, UserPlus } from 'lucide-react';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { Button } from '@/components/ui/button';

function authenticationReturnPath() {
  const params = new URLSearchParams(window.location.search);
  const inviteToken = params.get('invite') || '';
  if (inviteToken) return `/join/${encodeURIComponent(inviteToken)}`;
  if (params.get('esign')) return '/my-documents';
  return '/';
}

export function SignupPage() {
  const startUrl = `/api/auth/oidc/start?returnTo=${encodeURIComponent(authenticationReturnPath())}`;
  return <AuthLayout image="listening"><div>
    <div className="flex h-9 w-9 items-center justify-center border bg-card text-primary"><UserPlus className="h-4 w-4" /></div>
    <h1 className="mt-5 text-2xl font-semibold tracking-[-0.03em]">Create your Seemplify account</h1>
    <p className="mt-2 text-sm leading-6 text-muted-foreground">Experience Management uses Seemplify Identity. Continue to create or sign in to your central account, then return to the correct Experience organization automatically.</p>
    <Button className="mt-7 h-10 w-full" asChild>
      <a href={startUrl}>Continue with Seemplify <ArrowRight /></a>
    </Button>
    <p className="mt-6 border-t pt-5 text-center text-xs leading-5 text-muted-foreground">Your password, email verification, and organization invitations are handled by Seemplify Identity.</p>
  </div></AuthLayout>;
}
