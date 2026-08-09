'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { authApi } from '@/lib/api';
import { redirectToLogin, isPublicRoute, resetRedirectFlag } from '@/services/authGuard';

interface User {
    id: string;
    email: string;
    name: string;
    organizations: any[];
    teams: any[];
    currentOrganization: any;
}

interface AuthContextType {
    user: User | null;
    isAuthenticated: boolean;
    isLoading: boolean;
    logout: () => Promise<void>;
    switchOrganization: (orgId: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
    user: null,
    isAuthenticated: false,
    isLoading: true,
    logout: async () => { },
    switchOrganization: async () => { },
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const router = useRouter();
    const pathname = usePathname();

    // Check for hash token on mount and validate auth
    useEffect(() => {
        const handleInitialAuth = async () => {
            // Check for token in URL hash (OIDC callback)
            if (typeof window !== 'undefined') {
                const hash = window.location.hash;
                if (hash.includes('access_token=')) {
                    const accessToken = hash.split('access_token=')[1].split('&')[0];
                    localStorage.setItem('access_token', accessToken);
                    window.history.replaceState(null, '', window.location.pathname);
                    resetRedirectFlag(); // Reset flag after successful login
                }
            }

            const token = localStorage.getItem('access_token');
            const isPublic = pathname ? isPublicRoute(pathname) : false;

            // If no token and not on public route, redirect to login
            if (!token && !isPublic) {
                setLoading(false);
                redirectToLogin();
                return;
            }

            // If on public route, don't try to fetch user
            if (isPublic) {
                setLoading(false);
                return;
            }

            // Validate token by fetching user
            if (token) {
                try {
                    const response = await authApi.getMe();

                    setUser({
                        ...response.user,
                        currentOrganization: response.currentOrganization,
                    });
                    resetRedirectFlag(); // Reset flag after successful auth
                } catch (error: any) {
                    console.error('Failed to fetch user:', error);
                    
                    // Token expired or invalid - clear and redirect
                    localStorage.removeItem('access_token');
                    setUser(null);
                    
                    // Only redirect if not already on login page
                    if (!isPublic) {
                        redirectToLogin();
                    }
                }
            }

            setLoading(false);
        };

        handleInitialAuth();
    }, [pathname]);

    const logout = async () => {
        try {
            await authApi.logout();
            localStorage.removeItem('access_token');
            setUser(null);
            router.push('/login');
        } catch (error) {
            console.error('Logout error:', error);
        }
    };

    const switchOrganization = async (orgId: string) => {
        try {
            const response = await authApi.switchOrganization(orgId);
            if (response.success) {
                // Refresh full page to reload all data with new context
                window.location.reload();
            }
        } catch (error) {
            console.error('Switch org error:', error);
        }
    };

    return (
        <AuthContext.Provider
            value={{
                user,
                isAuthenticated: !!user,
                isLoading: loading,
                logout,
                switchOrganization,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
}

export const useAuth = () => useContext(AuthContext);
