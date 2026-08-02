"use client";

import { useAdmin } from '@/context/AdminContext';
import AdminSidebar from '@/components/AdminSidebar';
import AdminHeader from '@/components/AdminHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Key } from 'lucide-react';

export default function AdminLicensesPage() {
  const { checkPermission } = useAdmin();

  if (!checkPermission('manageLicenses')) {
    return (
      <div className="flex h-screen bg-gray-900">
        <AdminSidebar />
        <div className="flex-1 flex flex-col overflow-hidden">
          <AdminHeader />
          <main className="flex-1 overflow-y-auto bg-gray-900 p-6">
            <Card className="bg-gray-800 border-gray-700 max-w-2xl mx-auto mt-8">
              <CardContent className="p-6 text-center">
                <Key className="h-12 w-12 text-gray-500 mx-auto mb-4" />
                <h2 className="text-xl font-semibold text-white mb-2">Access Denied</h2>
                <p className="text-gray-400">You don't have permission to view licenses.</p>
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
                <CardTitle className="text-white">License Management</CardTitle>
                <CardDescription className="text-gray-400">
                  Manage and track all organization licenses
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-gray-300">License management features are integrated into the Organizations page.</p>
                <a href="/admin/organizations" className="text-blue-400 hover:text-blue-300 mt-2 inline-block">
                  Go to Organizations →
                </a>
              </CardContent>
            </Card>
          </div>
        </main>
      </div>
    </div>
  );
}
