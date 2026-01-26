'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, authApi } from '@/lib/api';

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

    // Check for hash token on mount
    useEffect(() => {
        const handleInitialAuth = async () => {
            // Check for token in URL hash
            if (typeof window !== 'undefined') {
                const hash = window.location.hash;
                if (hash.includes('access_token=')) {
                    const accessToken = hash.split('access_token=')[1].split('&')[0];
                    localStorage.setItem('access_token', accessToken);
                    window.history.replaceState(null, '', window.location.pathname);
                }
            }

            const token = localStorage.getItem('access_token');

            if (token) {
                try {
                    const response = await authApi.getMe();

                    setUser({
                        ...response.user,
                        currentOrganization: response.currentOrganization,
                    });
                } catch (error) {
                    console.error('Failed to fetch user:', error);
                    localStorage.removeItem('access_token');
                }
            }

            setLoading(false);
        };

        handleInitialAuth();
    }, []);

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
