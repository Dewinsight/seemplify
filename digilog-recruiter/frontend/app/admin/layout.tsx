"use client";

import { usePathname } from 'next/navigation';
import { AdminProvider } from '@/context/AdminContext';
import AdminProtectedRoute from '@/components/AdminProtectedRoute';

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  
  // Password reset routes should be public (no admin auth required)
  const isPasswordResetRoute = pathname?.startsWith('/admin/forgot-password') ||
                               pathname?.startsWith('/admin/reset-password');

  return (
    <AdminProvider>
      {isPasswordResetRoute ? (
        children
      ) : (
        <AdminProtectedRoute>
          {children}
        </AdminProtectedRoute>
      )}
    </AdminProvider>
  );
}
