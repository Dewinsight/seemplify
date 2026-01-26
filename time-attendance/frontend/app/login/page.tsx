'use client';

import { useEffect } from 'react';
import { authApi } from '@/lib/api';

export default function Login() {
    useEffect(() => {
        // Check for error in URL
        const params = new URLSearchParams(window.location.search);
        const error = params.get('error');
        if (error) {
            console.error('Login error:', error);
            // You could show a toast here
        }
    }, []);

    const handleLogin = () => {
        // Redirect to backend login endpoint which handles OIDC
        window.location.href = `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5010/api'}/auth/login`;
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-zinc-950 relative overflow-hidden">
            {/* Dynamic Background */}
            <div className="absolute inset-0 bg-noise" />
            <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-teal-500/20 rounded-full blur-3xl animate-pulse" />
            <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-cyan-500/20 rounded-full blur-3xl animate-pulse delay-1000" />

            <div className="relative z-10 w-full max-w-md px-4">
                <div className="bg-zinc-900/80 backdrop-blur-xl border border-white/10 rounded-2xl p-8 shadow-2xl">
                    <div className="text-center mb-8">
                        <div className="h-16 w-16 mx-auto bg-gradient-to-br from-teal-500 to-cyan-500 rounded-2xl flex items-center justify-center shadow-lg shadow-teal-500/20 mb-6">
                            <svg className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                        </div>
                        <h1 className="text-2xl font-bold text-white mb-2">Time & Attendance</h1>
                        <p className="text-zinc-400">Sign in to track your work hours</p>
                    </div>

                    <button
                        onClick={handleLogin}
                        className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-teal-500 to-cyan-600 hover:from-teal-400 hover:to-cyan-500 text-white font-semibold shadow-lg shadow-teal-500/20 hover:shadow-teal-500/40 transform hover:scale-[1.02] active:scale-[0.98] transition-all duration-200 flex items-center justify-center gap-3"
                    >
                        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#FFFFFF" />
                            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#FFFFFF" />
                            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FFFFFF" />
                            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#FFFFFF" />
                        </svg>
                        Sign in with Seemplify ID
                    </button>

                    <div className="mt-6 text-center text-xs text-zinc-500">
                        Protected by Seemplify Identity Provider
                    </div>
                </div>
            </div>
        </div>
    );
}
