"use client";

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle, CheckCircle2, ExternalLink, Shield } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAdmin } from '@/context/AdminContext';

type ExchangeState = 'loading' | 'success' | 'error';

export default function AdminSsoPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isLoading, login } = useAdmin();
  const [state, setState] = useState<ExchangeState>('loading');
  const [message, setMessage] = useState('Signing you into recruiter admin...');
  const hasAttemptedExchangeRef = useRef(false);

  useEffect(() => {
    if (isLoading) {
      return;
    }

    if (hasAttemptedExchangeRef.current) {
      return;
    }

    const token = searchParams.get('token');
    if (!token) {
      hasAttemptedExchangeRef.current = true;
      setState('error');
      setMessage('Recruiter admin SSO token is missing.');
      return;
    }

    hasAttemptedExchangeRef.current = true;
    let cancelled = false;

    const exchangeToken = async () => {
      try {
        const response = await fetch('/api/admin/auth/idp-exchange', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ token })
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(data.msg || 'Failed to sign into recruiter admin.');
        }

        if (cancelled) {
          return;
        }

        login(data.token, data.admin);
        setState('success');
        setMessage('Recruiter admin access granted. Redirecting to dashboard...');
        router.replace('/admin/dashboard');
      } catch (error) {
        if (cancelled) {
          return;
        }

        setState('error');
        setMessage(error instanceof Error ? error.message : 'Failed to sign into recruiter admin.');
      }
    };

    exchangeToken();

    return () => {
      cancelled = true;
    };
  }, [isLoading, login, router, searchParams]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 px-4">
      <Card className="w-full max-w-lg border-gray-700 bg-gray-800/70 backdrop-blur-xl">
        <CardHeader className="space-y-3">
          <div className="flex items-center justify-center">
            <div className="rounded-full bg-gradient-to-br from-blue-500 to-purple-600 p-3">
              <Shield className="h-8 w-8 text-white" />
            </div>
          </div>
          <CardTitle className="text-center text-2xl font-bold text-white">
            Recruiter Admin SSO
          </CardTitle>
          <CardDescription className="text-center text-gray-400">
            Completing your secure sign-in from the IDP admin.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {state === 'loading' && (
            <div className="flex flex-col items-center gap-4 py-6 text-center text-gray-300">
              <div className="h-12 w-12 animate-spin rounded-full border-2 border-gray-600 border-t-white" />
              <p>{message}</p>
            </div>
          )}

          {state === 'success' && (
            <Alert className="border-green-900 bg-green-900/20">
              <CheckCircle2 className="h-4 w-4 text-green-400" />
              <AlertDescription className="text-green-300">
                {message}
              </AlertDescription>
            </Alert>
          )}

          {state === 'error' && (
            <>
              <Alert variant="destructive" className="border-red-900 bg-red-900/20">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{message}</AlertDescription>
              </Alert>

              <div className="flex flex-col gap-3 pt-2 sm:flex-row">
                <Button asChild className="flex-1">
                  <Link href="/admin/login">
                    Go To Recruiter Admin Login
                  </Link>
                </Button>
                <Button asChild variant="outline" className="flex-1 border-gray-600 bg-transparent text-gray-200 hover:bg-gray-700">
                  <Link href="/" target="_blank" rel="noopener noreferrer">
                    Open Recruiter Home
                    <ExternalLink className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
