import React, { createContext, useContext, useEffect, useState } from 'react';
import api, {
    clearLegacySessionStorage,
    getPersistedActiveOrganizationId,
    setPersistedActiveOrganizationId
} from '../api';
import { hasCompletedNameProfile } from '../utils/userDisplay';
import type { RoleDefinition } from '../utils/access';

interface OrgPermission {
    department: { _id: string; name: string };
    roles: string[];
}

interface OrgMembership {
    _id: string;
    name: string;
    slug: string;
    logo?: string;
    logoDark?: string;
    logoLight?: string;
    logoBackground?: string;
    logoMode?: 'dark' | 'light' | 'system' | 'all';
    isAdmin: boolean;
    permissions: OrgPermission[];
    capabilities?: string[];
    roles?: RoleDefinition[];
}

interface User {
    id: string;
    username: string;
    firstName?: string;
    lastName?: string;
    email: string;
}

interface AuthContextType {
    user: User | null;
    organizations: OrgMembership[];
    activeOrganization: OrgMembership | null;
    needsOnboarding: boolean;
    login: (user: User, organizations: OrgMembership[]) => void;
    logout: () => void;
    switchOrganization: (org: OrgMembership) => void;
    refreshOrganizations: () => Promise<OrgMembership[]>;
    updateUserProfile: (nextUser: User) => void;
    isAuthenticated: boolean;
    isLoading: boolean;
    activeDepartment: { _id: string; name: string } | null;
    switchDepartment: (dept: { _id: string; name: string } | null) => void;
}

const ACTIVE_DEPARTMENT_KEY = 'activeDepartment';
const AuthContext = createContext<AuthContextType | undefined>(undefined);

const clearPersistedSessionState = () => {
    clearLegacySessionStorage();
    setPersistedActiveOrganizationId(null);
    localStorage.removeItem(ACTIVE_DEPARTMENT_KEY);
};

const readStoredDepartment = () => {
    const raw = localStorage.getItem(ACTIVE_DEPARTMENT_KEY);
    if (!raw) return null;

    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed._id === 'string' && typeof parsed.name === 'string'
            ? parsed
            : null;
    } catch (error) {
        localStorage.removeItem(ACTIVE_DEPARTMENT_KEY);
        return null;
    }
};

const persistDepartment = (dept: { _id: string; name: string } | null) => {
    if (dept) {
        localStorage.setItem(ACTIVE_DEPARTMENT_KEY, JSON.stringify(dept));
    } else {
        localStorage.removeItem(ACTIVE_DEPARTMENT_KEY);
    }
};

const selectActiveOrganization = (
    orgs: OrgMembership[],
    preferredOrganizationId: string | null
) => {
    if (orgs.length === 0) return null;
    if (!preferredOrganizationId) return orgs[0];
    return orgs.find((org) => org._id === preferredOrganizationId) || orgs[0];
};

const resolveActiveDepartment = (
    org: OrgMembership | null,
    preferredDepartment: { _id: string; name: string } | null,
    fallbackToFirst: boolean
) => {
    if (!org) return null;

    if (preferredDepartment) {
        if (org.isAdmin) return preferredDepartment;
        const matchingDepartment = org.permissions
            ?.map((permission) => permission.department)
            .find((department) => department?._id === preferredDepartment._id);
        if (matchingDepartment) return matchingDepartment;
    }

    if (!fallbackToFirst) return null;

    const firstDepartment = org.permissions?.[0]?.department;
    return firstDepartment && typeof firstDepartment === 'object' ? firstDepartment : null;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<User | null>(null);
    const [organizations, setOrganizations] = useState<OrgMembership[]>([]);
    const [activeOrganization, setActiveOrganization] = useState<OrgMembership | null>(null);
    const [loading, setLoading] = useState(true);
    const [activeDepartment, setActiveDepartment] = useState<{ _id: string; name: string } | null>(null);

    const needsOnboarding = !!user && (!hasCompletedNameProfile(user) || organizations.length === 0);

    useEffect(() => {
        let cancelled = false;

        const bootstrapSession = async () => {
            const preferredOrganizationId = getPersistedActiveOrganizationId();
            const preferredDepartment = readStoredDepartment();

            clearLegacySessionStorage();

            try {
                const response = await api.get('/auth/session');
                if (cancelled) return;

                const sessionUser: User | null = response.data?.user || null;
                const orgs: OrgMembership[] = Array.isArray(response.data?.organizations)
                    ? response.data.organizations
                    : [];
                const nextActiveOrganization = selectActiveOrganization(orgs, preferredOrganizationId);
                const nextActiveDepartment = resolveActiveDepartment(
                    nextActiveOrganization,
                    preferredDepartment,
                    false
                );

                setUser(sessionUser);
                setOrganizations(orgs);
                setActiveOrganization(nextActiveOrganization);
                setPersistedActiveOrganizationId(nextActiveOrganization?._id || null);
                setActiveDepartment(nextActiveDepartment);
                persistDepartment(nextActiveDepartment);
            } catch (error) {
                if (cancelled) return;
                clearPersistedSessionState();
                setUser(null);
                setOrganizations([]);
                setActiveOrganization(null);
                setActiveDepartment(null);
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        void bootstrapSession();

        return () => {
            cancelled = true;
        };
    }, []);

    const login = (userData: User, orgs: OrgMembership[]) => {
        clearLegacySessionStorage();
        setUser(userData);
        setOrganizations(orgs);

        if (orgs.length > 0) {
            const nextActiveOrganization = orgs[0];
            const nextActiveDepartment = resolveActiveDepartment(nextActiveOrganization, null, true);
            setActiveOrganization(nextActiveOrganization);
            setPersistedActiveOrganizationId(nextActiveOrganization._id);
            setActiveDepartment(nextActiveDepartment);
            persistDepartment(nextActiveDepartment);
        } else {
            setActiveOrganization(null);
            setPersistedActiveOrganizationId(null);
            setActiveDepartment(null);
            persistDepartment(null);
        }
    };

    const logout = () => {
        void api.post('/auth/logout').catch(() => {});
        clearPersistedSessionState();
        setUser(null);
        setOrganizations([]);
        setActiveOrganization(null);
        setActiveDepartment(null);
    };

    const switchOrganization = (org: OrgMembership) => {
        const nextActiveDepartment = resolveActiveDepartment(org, null, true);
        setActiveOrganization(org);
        setPersistedActiveOrganizationId(org._id);
        setActiveDepartment(nextActiveDepartment);
        persistDepartment(nextActiveDepartment);
    };

    const refreshOrganizations = async (): Promise<OrgMembership[]> => {
        try {
            const res = await api.get('/organizations/my');
            const orgs: OrgMembership[] = Array.isArray(res.data) ? res.data : [];
            setOrganizations(orgs);

            const preferredOrganizationId = activeOrganization?._id || getPersistedActiveOrganizationId();
            const nextActiveOrganization = selectActiveOrganization(orgs, preferredOrganizationId);
            const nextActiveDepartment = resolveActiveDepartment(
                nextActiveOrganization,
                activeDepartment,
                false
            );

            setActiveOrganization(nextActiveOrganization);
            setPersistedActiveOrganizationId(nextActiveOrganization?._id || null);
            setActiveDepartment(nextActiveDepartment);
            persistDepartment(nextActiveDepartment);

            return orgs;
        } catch (error) {
            console.error('Failed to refresh organizations:', error);
            return [];
        }
    };

    const updateUserProfile = (nextUser: User) => {
        setUser(nextUser);
    };

    const switchDepartment = (dept: { _id: string; name: string } | null) => {
        setActiveDepartment(dept);
        persistDepartment(dept);
    };

    return (
        <AuthContext.Provider value={{
            user,
            organizations,
            activeOrganization,
            needsOnboarding,
            login,
            logout,
            switchOrganization,
            refreshOrganizations,
            updateUserProfile,
            isAuthenticated: !!user,
            isLoading: loading,
            activeDepartment,
            switchDepartment
        }}>
            {!loading && children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) throw new Error('useAuth must be used within an AuthProvider');
    return context;
};
