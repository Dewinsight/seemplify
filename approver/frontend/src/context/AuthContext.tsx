import React, { createContext, useContext, useState, useEffect } from 'react';
import api from '../api';
import { hasCompletedNameProfile } from '../utils/userDisplay';

interface OrgPermission {
    department: { _id: string; name: string };
    roles: string[];
}

interface OrgMembership {
    _id: string;       // organization _id
    name: string;
    slug: string;
    logo?: string;     // path to uploaded logo (used when logoMode is 'all')
    logoDark?: string; // logo for dark theme
    logoLight?: string; // logo for light theme
    logoBackground?: string;  // 'transparent' or hex color
    logoMode?: 'dark' | 'light' | 'system' | 'all';  // when to show logo
    isAdmin: boolean;
    permissions: OrgPermission[];
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
    login: (token: string, user: User, organizations: OrgMembership[]) => void;
    logout: () => void;
    switchOrganization: (org: OrgMembership) => void;
    refreshOrganizations: () => Promise<OrgMembership[]>;
    updateUserProfile: (nextUser: User) => void;
    isAuthenticated: boolean;
    isLoading: boolean;
    activeDepartment: { _id: string; name: string } | null;
    switchDepartment: (dept: { _id: string; name: string } | null) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<User | null>(null);
    const [organizations, setOrganizations] = useState<OrgMembership[]>([]);
    const [activeOrganization, setActiveOrganization] = useState<OrgMembership | null>(null);
    const [loading, setLoading] = useState(true);
    const [activeDepartment, setActiveDepartment] = useState<{ _id: string; name: string } | null>(null);

    const needsOnboarding = !!user && (!hasCompletedNameProfile(user) || organizations.length === 0);

    useEffect(() => {
        const storedUser = localStorage.getItem('user');
        const token = localStorage.getItem('token');
        const storedOrgs = localStorage.getItem('organizations');
        const storedActiveOrg = localStorage.getItem('activeOrganization');
        const storedDept = localStorage.getItem('activeDepartment');

        if (storedUser && token) {
            const parsedUser = JSON.parse(storedUser);
            setUser(parsedUser);
            api.defaults.headers.common['Authorization'] = `Bearer ${token}`;

            if (storedOrgs) {
                const parsedOrgs: OrgMembership[] = JSON.parse(storedOrgs);
                setOrganizations(parsedOrgs);

                // Restore active org
                if (storedActiveOrg) {
                    const parsedActiveOrg: OrgMembership = JSON.parse(storedActiveOrg);
                    // Make sure active org still exists in the list (might have been removed)
                    const stillValid = parsedOrgs.find(o => o._id === parsedActiveOrg._id);
                    if (stillValid) {
                        setActiveOrganization(stillValid);
                    } else if (parsedOrgs.length > 0) {
                        setActiveOrganization(parsedOrgs[0]);
                        localStorage.setItem('activeOrganization', JSON.stringify(parsedOrgs[0]));
                    }
                } else if (parsedOrgs.length > 0) {
                    setActiveOrganization(parsedOrgs[0]);
                    localStorage.setItem('activeOrganization', JSON.stringify(parsedOrgs[0]));
                }
            }

            // Restore active department
            if (storedDept) {
                setActiveDepartment(JSON.parse(storedDept));
            }
        }
        setLoading(false);
    }, []);

    const login = (token: string, userData: User, orgs: OrgMembership[]) => {
        localStorage.setItem('token', token);
        localStorage.setItem('user', JSON.stringify(userData));
        localStorage.setItem('organizations', JSON.stringify(orgs));
        api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
        setUser(userData);
        setOrganizations(orgs);

        // Set default active org
        if (orgs.length > 0) {
            setActiveOrganization(orgs[0]);
            localStorage.setItem('activeOrganization', JSON.stringify(orgs[0]));

            // Set default department from first org's permissions
            if (orgs[0].permissions && orgs[0].permissions.length > 0) {
                const firstDept = orgs[0].permissions[0].department;
                if (typeof firstDept === 'object' && firstDept.name) {
                    setActiveDepartment(firstDept);
                    localStorage.setItem('activeDepartment', JSON.stringify(firstDept));
                }
            }
        } else {
            setActiveOrganization(null);
            localStorage.removeItem('activeOrganization');
            localStorage.removeItem('activeDepartment');
        }
    };

    const logout = () => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        localStorage.removeItem('organizations');
        localStorage.removeItem('activeOrganization');
        localStorage.removeItem('activeDepartment');
        delete api.defaults.headers.common['Authorization'];
        setUser(null);
        setOrganizations([]);
        setActiveOrganization(null);
        setActiveDepartment(null);
    };

    const switchOrganization = (org: OrgMembership) => {
        setActiveOrganization(org);
        localStorage.setItem('activeOrganization', JSON.stringify(org));

        // Reset department when switching org
        setActiveDepartment(null);
        localStorage.removeItem('activeDepartment');

        // Auto-select first department from new org's permissions
        if (org.permissions && org.permissions.length > 0) {
            const firstDept = org.permissions[0].department;
            if (typeof firstDept === 'object' && firstDept.name) {
                setActiveDepartment(firstDept);
                localStorage.setItem('activeDepartment', JSON.stringify(firstDept));
            }
        }
    };

    const refreshOrganizations = async (): Promise<OrgMembership[]> => {
        try {
            const res = await api.get('/organizations/my');
            const orgs: OrgMembership[] = res.data;
            setOrganizations(orgs);
            localStorage.setItem('organizations', JSON.stringify(orgs));

            // If no active org but we now have orgs, set the first one
            if (!activeOrganization && orgs.length > 0) {
                setActiveOrganization(orgs[0]);
                localStorage.setItem('activeOrganization', JSON.stringify(orgs[0]));
            }
            // If active org was removed, reset to first
            if (activeOrganization && !orgs.find(o => o._id === activeOrganization._id)) {
                if (orgs.length > 0) {
                    setActiveOrganization(orgs[0]);
                    localStorage.setItem('activeOrganization', JSON.stringify(orgs[0]));
                } else {
                    setActiveOrganization(null);
                    localStorage.removeItem('activeOrganization');
                }
            }
            return orgs;
        } catch (error) {
            console.error('Failed to refresh organizations:', error);
            return [];
        }
    };

    const updateUserProfile = (nextUser: User) => {
        setUser(nextUser);
        localStorage.setItem('user', JSON.stringify(nextUser));
    };

    const switchDepartment = (dept: { _id: string; name: string } | null) => {
        setActiveDepartment(dept);
        if (dept) {
            localStorage.setItem('activeDepartment', JSON.stringify(dept));
        } else {
            localStorage.removeItem('activeDepartment');
        }
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
