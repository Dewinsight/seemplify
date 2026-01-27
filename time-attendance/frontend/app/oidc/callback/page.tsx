'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';

export default function OidcCallbackPage() {
    const router = useRouter();
    const searchParams = useSearchParams();

    useEffect(() => {
        const handleCallback = () => {
            // 1. Try to get token from Query Params (?token=...)
            let token = searchParams.get('token');
            const error = searchParams.get('error');

            // 2. If not in Query, try Hash Fragment (#access_token=...)
            // This matches Leave Management's OIDC behavior
            if (!token && typeof window !== 'undefined') {
                const hash = window.location.hash;
                if (hash && hash.includes('access_token=')) {
                    token = hash.split('access_token=')[1]?.split('&')[0];
                }
            }

            if (token) {
                // Store token in localStorage
                localStorage.setItem('access_token', token);

                // Clear the hash from URL to clean up
                window.history.replaceState(null, '', window.location.pathname);

                // Redirect to dashboard
                // Small timeout to ensure storage is set
                setTimeout(() => {
                    router.push('/dashboard');
                }, 100);
            } else if (error) {
                router.push(`/login?error=${encodeURIComponent(error)}`);
            } else {
                // Only redirect to login if we really checked everything and found nothing.
                // But wait a moment in case hydration/router is slow? 
                // No, useEffect runs after mount. If hash is there, we see it.
                // If query is there, we see it.
                router.push('/login');
            }
        };

        handleCallback();
    }, [router, searchParams]);

    return (
        <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
            <div className="text-center space-y-4">
                <Loader2 className="w-8 h-8 text-teal-500 animate-spin mx-auto" />
                <p className="text-zinc-400 text-sm">Completing authentication...</p>
            </div>
        </div>
    );
}
