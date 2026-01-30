import React, { createContext, useContext, useState, useEffect } from 'react';
import api from '../api';

interface User {
    id: string;
    username: string;
    email: string;
    role: 'Admin' | 'Approver' | 'Requester';
    department: string;
    isAdmin?: boolean;
    permissions?: { department: { _id: string, name: string }, role: string }[];
}

interface AuthContextType {
    user: User | null;
    login: (token: string, user: User) => void;
    logout: () => void;
    isAuthenticated: boolean;
    isLoading: boolean;
    activeDepartment: { _id: string, name: string } | null;
    switchDepartment: (dept: { _id: string, name: string } | null) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [activeDepartment, setActiveDepartment] = useState<{ _id: string, name: string } | null>(null);

    useEffect(() => {
        const storedUser = localStorage.getItem('user');
        const token = localStorage.getItem('token');
        const storedDept = localStorage.getItem('activeDepartment');

        if (storedUser && token) {
            const parsedUser = JSON.parse(storedUser);
            setUser(parsedUser);
            // Set default auth header
            api.defaults.headers.common['Authorization'] = `Bearer ${token}`;

            // Restore active department or default
            if (storedDept) {
                setActiveDepartment(JSON.parse(storedDept));
            } else if (parsedUser.permissions && parsedUser.permissions.length > 0) {
                // Default to first
                const first = parsedUser.permissions[0].department;
                // It might be populated object or string. Handle both.
                if (typeof first === 'object' && first.name) {
                    setActiveDepartment(first);
                }
            }
        }
        setLoading(false);
    }, []);

    const login = (token: string, userData: User) => {
        localStorage.setItem('token', token);
        localStorage.setItem('user', JSON.stringify(userData));
        api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
        setUser(userData);

        // Set Default Dept
        if (userData.permissions && userData.permissions.length > 0) {
            const first = userData.permissions[0].department;
            // Ensure it is object
            if (typeof first === 'object') {
                setActiveDepartment(first);
                localStorage.setItem('activeDepartment', JSON.stringify(first));
            }
        }
    };

    const logout = () => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        localStorage.removeItem('activeDepartment');
        delete api.defaults.headers.common['Authorization'];
        setUser(null);
        setActiveDepartment(null);
    };

    const switchDepartment = (dept: { _id: string, name: string } | null) => {
        setActiveDepartment(dept);
        if (dept) {
            localStorage.setItem('activeDepartment', JSON.stringify(dept));
        } else {
            localStorage.removeItem('activeDepartment');
        }
    };

    return (
        <AuthContext.Provider value={{ user, login, logout, isAuthenticated: !!user, isLoading: loading, activeDepartment, switchDepartment }}>
            {!loading && children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) throw new Error('useAuth must be used within an AuthProvider');
    return context;
};
