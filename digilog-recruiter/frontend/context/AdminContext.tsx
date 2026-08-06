"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { apiRequest } from '@/services/apiConfig';

interface AdminPermissions {
  manageUsers: boolean;
  manageOrganizations: boolean;
  manageLicenses: boolean;
  manageBilling: boolean;
  viewAnalytics: boolean;
  systemSettings: boolean;
}

interface Admin {
  id: string;
  email: string;
  name: string;
  role: 'super_admin' | 'admin' | 'support';
  permissions: AdminPermissions;
}

interface AdminContextType {
  admin: Admin | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (token: string, adminData: Admin) => void;
  logout: () => void;
  checkPermission: (permission: keyof AdminPermissions) => boolean;
  isSuperAdmin: () => boolean;
}

const AdminContext = createContext<AdminContextType | undefined>(undefined);

export const AdminProvider = ({ children }: { children: ReactNode }) => {
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    // Check for existing admin session
    const checkAdminAuth = async () => {
      const token = localStorage.getItem('adminToken');
      const adminData = localStorage.getItem('adminData');

      if (token && adminData) {
        try {
          // Verify token with backend
          const response = await apiRequest('/api/admin/auth/me', {
            headers: {
              'x-admin-auth-token': token
            }
          });

          if (response.ok) {
            const data = await response.json();
            setAdmin(data);
            setIsAuthenticated(true);
          } else {
            // Token invalid, clear storage
            localStorage.removeItem('adminToken');
            localStorage.removeItem('adminData');
          }
        } catch (error) {
          console.error('Error verifying admin token:', error);
          localStorage.removeItem('adminToken');
          localStorage.removeItem('adminData');
        }
      }
      
      setIsLoading(false);
    };

    checkAdminAuth();
  }, []);

  const login = (token: string, adminData: Admin) => {
    console.log('🔐 AdminContext login called:', { adminData });
    localStorage.setItem('adminToken', token);
    localStorage.setItem('adminData', JSON.stringify(adminData));
    setAdmin(adminData);
    setIsAuthenticated(true);
    console.log('✅ AdminContext login completed - isAuthenticated now true');
  };

  const logout = () => {
    localStorage.removeItem('adminToken');
    localStorage.removeItem('adminData');
    setAdmin(null);
    setIsAuthenticated(false);
    router.push('/admin/login');
  };

  const checkPermission = (permission: keyof AdminPermissions): boolean => {
    if (!admin) return false;
    if (admin.role === 'super_admin') return true; // Super admin has all permissions
    return admin.permissions[permission] || false;
  };

  const isSuperAdmin = (): boolean => {
    return admin?.role === 'super_admin' || false;
  };

  return (
    <AdminContext.Provider value={{
      admin,
      isAuthenticated,
      isLoading,
      login,
      logout,
      checkPermission,
      isSuperAdmin
    }}>
      {children}
    </AdminContext.Provider>
  );
};

export const useAdmin = () => {
  const context = useContext(AdminContext);
  if (context === undefined) {
    throw new Error('useAdmin must be used within an AdminProvider');
  }
  return context;
};
