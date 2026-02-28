"use client";

import { useAdmin } from '@/context/AdminContext';
import AdminSidebar from '@/components/AdminSidebar';
import AdminHeader from '@/components/AdminHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CreditCard } from 'lucide-react';

export default function AdminBillingPage() {
  const { checkPermission } = useAdmin();

  if (!checkPermission('manageBilling')) {
    return (
      <div className="flex h-screen bg-gray-900">
        <AdminSidebar />
        <div className="flex-1 flex flex-col overflow-hidden">
          <AdminHeader />
          <main className="flex-1 overflow-y-auto bg-gray-900 p-6">
            <Card className="bg-gray-800 border-gray-700 max-w-2xl mx-auto mt-8">
              <CardContent className="p-6 text-center">
                <CreditCard className="h-12 w-12 text-gray-500 mx-auto mb-4" />
                <h2 className="text-xl font-semibold text-white mb-2">Access Denied</h2>
                <p className="text-gray-400">You don't have permission to view billing.</p>
              </CardContent>
            </Card>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gray-900">
      <AdminSidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <AdminHeader />
        <main className="flex-1 overflow-y-auto bg-gray-900 p-6">
          <div className="max-w-7xl mx-auto">
            <Card className="bg-gray-800 border-gray-700">
              <CardHeader>
                <CardTitle className="text-white">Billing Management</CardTitle>
                <CardDescription className="text-gray-400">
                  Manage billing and payment information
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-gray-300">Billing features coming soon.</p>
              </CardContent>
            </Card>
          </div>
        </main>
      </div>
    </div>
  );
}
